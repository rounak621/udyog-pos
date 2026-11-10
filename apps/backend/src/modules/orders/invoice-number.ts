import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_INVOICE_PREFIX,
  financialYearOf,
  formatInvoiceNo,
} from '@nodedr-restaurant/types';

// India sales invoice numbers (see packages/types/src/invoice.ts for the
// format). Called ONLY inside the checkout transaction that turns an order
// fully PAID. The INSERT ... ON CONFLICT DO UPDATE ... RETURNING takes the
// series row lock until commit, so concurrent checkouts queue and get
// consecutive numbers; if the transaction rolls back, the increment rolls
// back with it and no number is consumed.

export interface AllocatedInvoice {
  invoiceNo: string;
  invoiceSeriesId: string;
  invoiceIssuedAt: Date;
  invoiceRestaurantId: string;
}

export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  args: {
    restaurantId: string;
    branchId: string;
    prefix: string | null | undefined;
    now?: Date;
  },
): Promise<AllocatedInvoice> {
  const now = args.now ?? new Date();
  const prefix = args.prefix?.trim().toUpperCase() || DEFAULT_INVOICE_PREFIX;
  const fy = financialYearOf(now);
  const rows = await tx.$queryRaw<{ id: string; lastNumber: number }[]>`
    INSERT INTO "invoice_series"
      ("id", "restaurantId", "branchId", "prefix", "financialYear", "fyShort", "lastNumber")
    VALUES (${randomUUID()}, ${args.restaurantId}, ${args.branchId}, ${prefix}, ${fy.label}, ${fy.short}, 1)
    ON CONFLICT ("restaurantId", "prefix", "financialYear") DO UPDATE
      SET "lastNumber" = "invoice_series"."lastNumber" + 1
    RETURNING "id", "lastNumber"`;
  const row = rows[0];
  return {
    invoiceNo: formatInvoiceNo(prefix, fy.short, Number(row.lastNumber)),
    invoiceSeriesId: row.id,
    invoiceIssuedAt: now,
    invoiceRestaurantId: args.restaurantId,
  };
}
