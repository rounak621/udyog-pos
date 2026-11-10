import { z } from "zod";

// India sales invoice numbers: <PREFIX>/<FYSHORT>/<6 digits>, e.g.
// INV/2627/000001 (at most 4 + 1 + 4 + 1 + 6 = 16 characters). One
// consecutive series per (restaurant, prefix, financial year). The financial
// year runs 1 April to 31 March on the India (Asia/Kolkata) calendar.
// Pure helpers: shared by the backend and, later, the offline client.

export const INVOICE_TIME_ZONE = "Asia/Kolkata";
export const DEFAULT_INVOICE_PREFIX = "INV";
export const INVOICE_NUMBER_DIGITS = 6;
export const INVOICE_NUMBER_MAX_LENGTH = 16;

/** 1-4 letters/digits, stored uppercase. */
export const invoicePrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,4}$/, "Use 1 to 4 letters or numbers");

export interface FinancialYear {
  /** "2026-27" */
  label: string;
  /** "2627" (used inside the invoice number) */
  short: string;
  /** 2026 for 1 Apr 2026 - 31 Mar 2027 */
  startYear: number;
}

/** Calendar date parts (year, month 1-12, day) of an instant in India time. */
export function istDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INVOICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** "YYYY-MM-DD" of an instant in India time. */
export function istDateString(date: Date): string {
  const { year, month, day } = istDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Indian financial year (1 April - 31 March, IST) containing `date`. */
export function financialYearOf(date: Date): FinancialYear {
  const { year, month } = istDateParts(date);
  const startYear = month >= 4 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  const startShort = String(startYear % 100).padStart(2, "0");
  return {
    label: `${startYear}-${endShort}`,
    short: `${startShort}${endShort}`,
    startYear,
  };
}

/** PREFIX/FYSHORT/NNNNNN. Throws on an invalid prefix, number or length. */
export function formatInvoiceNo(prefix: string, fyShort: string, n: number): string {
  const p = invoicePrefixSchema.parse(prefix);
  if (!/^\d{4}$/.test(fyShort)) throw new Error("Financial year must be 4 digits, e.g. 2627");
  if (!Number.isInteger(n) || n < 1 || n >= 10 ** INVOICE_NUMBER_DIGITS) {
    throw new Error("Invoice sequence out of range");
  }
  const value = `${p}/${fyShort}/${String(n).padStart(INVOICE_NUMBER_DIGITS, "0")}`;
  if (value.length > INVOICE_NUMBER_MAX_LENGTH) throw new Error("Invoice number longer than 16 characters");
  return value;
}

/** DD/MM/YYYY of an instant in India time (printed as the invoice date). */
export function istDisplayDate(date: Date): string {
  const { year, month, day } = istDateParts(date);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}
