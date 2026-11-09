import type { Prisma } from '@prisma/client';
import { gstinStateCode, splitIndiaGst } from '@nodedr-restaurant/types';
import type { CompanyDetails } from './billing-config';

// GST tax invoices for UDYOG's own subscription charges.

/** Indian financial year (1 April - 31 March, Asia/Kolkata), e.g. "2026-27". */
export function financialYearFor(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(financialYear: string, n: number): string {
  return `UDYOG/${financialYear}/${String(n).padStart(6, '0')}`;
}

/**
 * Next number for the year. One atomic upsert: ON CONFLICT DO UPDATE locks
 * the counter row until the surrounding transaction ends, so two webhooks
 * can never get the same number.
 */
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  financialYear: string,
): Promise<string> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "invoice_counters" ("financialYear", "lastNumber") VALUES (${financialYear}, 1)
    ON CONFLICT ("financialYear") DO UPDATE
      SET "lastNumber" = "invoice_counters"."lastNumber" + 1
    RETURNING "lastNumber"`;
  return formatInvoiceNumber(financialYear, Number(rows[0].lastNumber));
}

export interface InvoiceSnapshot {
  seller: { name: string; gstin: string; address: string; stateCode: string };
  buyer: {
    name: string;
    branchName: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string | null;
  };
  lines: { description: string; sac: string; taxableValuePaise: number }[];
  gstRatePercent: number;
  taxableValuePaise: number;
  taxLines: { label: 'CGST' | 'SGST' | 'IGST'; amountPaise: number }[];
  totalPaise: number;
  period: { start: string | null; end: string | null };
}

/**
 * Tax split with the shared splitIndiaGst: seller state = COMPANY_GSTIN's,
 * place of supply = the buyer branch GSTIN's state. A buyer without a GSTIN
 * has no place of supply, so the function's rule gives CGST + SGST.
 */
export function buildInvoiceSnapshot(input: {
  company: CompanyDetails;
  buyer: {
    name: string;
    branchName: string | null;
    address: string | null;
    gstin: string | null;
  };
  description: string;
  taxableValuePaise: number;
  taxPaise: number;
  period: { start: Date | null; end: Date | null };
}): InvoiceSnapshot {
  const buyerState = gstinStateCode(input.buyer.gstin);
  const taxLines = splitIndiaGst(input.taxPaise / 100, {
    branchStateCode: input.company.stateCode,
    placeOfSupplyStateCode: buyerState,
  }).map((l) => ({ label: l.label, amountPaise: Math.round(l.amount * 100) }));
  return {
    seller: {
      name: input.company.name,
      gstin: input.company.gstin,
      address: input.company.address,
      stateCode: input.company.stateCode,
    },
    buyer: {
      ...input.buyer,
      gstin: buyerState ? input.buyer.gstin : null,
      stateCode: buyerState,
    },
    lines: [
      {
        description: input.description,
        sac: input.company.sac,
        taxableValuePaise: input.taxableValuePaise,
      },
    ],
    gstRatePercent: input.company.gstRatePercent,
    taxableValuePaise: input.taxableValuePaise,
    taxLines,
    totalPaise: input.taxableValuePaise + input.taxPaise,
    period: {
      start: input.period.start?.toISOString() ?? null,
      end: input.period.end?.toISOString() ?? null,
    },
  };
}

/** Issues the invoice for a captured payment inside the caller's transaction. */
export async function createInvoiceForPayment(
  tx: Prisma.TransactionClient,
  input: {
    company: CompanyDetails;
    paymentId: string;
    restaurantId: string;
    description: string;
    taxableValuePaise: number;
    taxPaise: number;
    period: { start: Date | null; end: Date | null };
    now?: Date;
  },
) {
  const restaurant = await tx.restaurant.findUniqueOrThrow({
    where: { id: input.restaurantId },
    select: {
      name: true,
      branches: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { name: true, address: true, taxId: true, gstNumber: true },
      },
    },
  });
  const branch = restaurant.branches[0];
  const now = input.now ?? new Date();
  const financialYear = financialYearFor(now);
  const invoiceNumber = await nextInvoiceNumber(tx, financialYear);
  const snapshot = buildInvoiceSnapshot({
    company: input.company,
    buyer: {
      name: restaurant.name,
      branchName: branch?.name ?? null,
      address: branch?.address ?? null,
      gstin: branch?.taxId || branch?.gstNumber || null,
    },
    description: input.description,
    taxableValuePaise: input.taxableValuePaise,
    taxPaise: input.taxPaise,
    period: input.period,
  });
  const invoice = await tx.subscriptionInvoice.create({
    data: {
      restaurantId: input.restaurantId,
      paymentId: input.paymentId,
      invoiceNumber,
      financialYear,
      issuedAt: now,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.subscriptionPayment.update({
    where: { id: input.paymentId },
    data: { invoiceId: invoice.id },
  });
  return invoice;
}
