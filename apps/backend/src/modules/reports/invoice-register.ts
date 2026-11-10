import {
  gstinStateCode,
  istDisplayDate,
  splitIndiaGst,
} from '@nodedr-restaurant/types';
import { gstSummary, round2 } from '../accounting/accounting.calc';
import type { CsvValue } from './csv';

// India sales invoice register: one row per order that has an invoice
// number. No new tax maths: the taxable value comes from gstSummary (the
// same calculation as the GST report) and the CGST/SGST/IGST split from
// splitIndiaGst (the same call the receipts make).

export const INVOICE_REGISTER_MAX_DAYS = 400;

export const INVOICE_REGISTER_COLUMNS = [
  'Invoice No',
  'Invoice date',
  'Order number',
  'Customer name',
  'Customer GSTIN',
  'Place of supply',
  'HSN/SAC',
  'Taxable value',
  'CGST',
  'SGST',
  'IGST',
  'Total',
  'Payment methods',
  'Status',
  'Refunded',
];

export interface RegisterOrder {
  invoiceNo: string | null;
  invoiceIssuedAt: Date | null;
  orderNumber: string;
  status: string;
  guestName: string | null;
  customer: { name: string | null } | null;
  customerGstin: string | null;
  placeOfSupplyStateCode: string | null;
  subtotal: unknown;
  discountAmount: unknown;
  loyaltyDiscountAmount: unknown;
  taxAmount: unknown;
  totalAmount: unknown;
  items: {
    lineTotal: unknown;
    taxRateSnapshot: unknown;
    hsnSacSnapshot: string | null;
  }[];
  payments: { method: string }[];
  refunds: { amount: unknown }[];
}

export interface RegisterBranch {
  taxId: string | null;
  gstNumber: string | null;
}

export function invoiceRegisterRow(
  order: RegisterOrder,
  branch: RegisterBranch,
): CsvValue[] {
  const subtotal = Number(order.subtotal);
  const charged =
    subtotal -
    Number(order.discountAmount) -
    Number(order.loyaltyDiscountAmount);
  const factor = subtotal > 0 ? Math.max(0, charged) / subtotal : 1;
  const { totalTaxable } = gstSummary(
    order.items.map((i) => ({
      lineTotal: Number(i.lineTotal),
      taxRatePercent: Number(i.taxRateSnapshot),
      factor,
    })),
  );
  const split = splitIndiaGst(Number(order.taxAmount), {
    branchStateCode: gstinStateCode(branch.taxId || branch.gstNumber),
    placeOfSupplyStateCode: order.placeOfSupplyStateCode,
  });
  const tax = (label: string) =>
    round2(
      split.filter((l) => l.label === label).reduce((s, l) => s + l.amount, 0),
    );
  const hsn = [
    ...new Set(order.items.map((i) => i.hsnSacSnapshot).filter(Boolean)),
  ].join(', ');
  const methods = [...new Set(order.payments.map((p) => p.method))].join(', ');
  const refunded = round2(
    order.refunds.reduce((s, r) => s + Number(r.amount), 0),
  );
  return [
    order.invoiceNo,
    order.invoiceIssuedAt ? istDisplayDate(order.invoiceIssuedAt) : '',
    order.orderNumber,
    order.customer?.name ?? order.guestName ?? '',
    order.customerGstin ?? '',
    order.placeOfSupplyStateCode ?? '',
    hsn,
    totalTaxable,
    tax('CGST'),
    tax('SGST'),
    tax('IGST'),
    round2(Number(order.totalAmount)),
    methods,
    order.status,
    refunded,
  ];
}

/** Validates YYYY-MM-DD dates, from <= to and at most 400 days. */
export function checkRegisterRange(from: string, to: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from ?? '') || !re.test(to ?? '')) {
    return 'from and to must be dates (YYYY-MM-DD)';
  }
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Invalid date';
  if (a > b) return 'from must be on or before to';
  if ((b - a) / 86_400_000 + 1 > INVOICE_REGISTER_MAX_DAYS) {
    return `The range can be at most ${INVOICE_REGISTER_MAX_DAYS} days`;
  }
  return null;
}
