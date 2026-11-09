import { z } from "zod";

// Multi-region tax support (2026-09-27). A branch picks a TaxRegime, which
// supplies sensible defaults for how the receipt labels tax and whether
// menu item prices already have tax baked in. See ARCHITECTURE.md and
// apps/backend/src/modules/orders/pricing.ts for the pricing-math side of
// this — this file is only the shared preset table + branch tax-settings
// DTO, used by both the API and the web app so the two never drift.

export const TAX_MODES = ["INCLUSIVE", "EXCLUSIVE"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_REGIMES = [
  "INDIA_GST",
  "US_SALES_TAX",
  "EU_VAT",
  "ES_IVA",
  "CUSTOM",
] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export interface TaxRegimePreset {
  regime: TaxRegime;
  /** Shown in the Settings picker. */
  displayName: string;
  /** Default menu-item pricing mode for this regime. */
  defaultMode: TaxMode;
  /** What the receipt/POS calls the tax line, e.g. "GST", "VAT", "Sales Tax". */
  taxLabel: string;
  /** Label for the branch's tax registration number field. */
  taxIdLabel: string;
  /** India-only: split the tax line into CGST/SGST halves on receipts. */
  splitCgstSgst: boolean;
  /** A couple of illustrative example rates — NOT prescriptive or legal advice. */
  exampleRates: string;
  /** Suggested default country (ISO 3166-1 alpha-2) when this regime is picked. */
  defaultCountry: string;
}

export const TAX_REGIME_PRESETS: Record<TaxRegime, TaxRegimePreset> = {
  INDIA_GST: {
    regime: "INDIA_GST",
    displayName: "India — GST",
    defaultMode: "INCLUSIVE",
    taxLabel: "GST",
    taxIdLabel: "GSTIN",
    splitCgstSgst: true,
    exampleRates: "5% / 12% / 18% (typical restaurant slabs)",
    defaultCountry: "IN",
  },
  US_SALES_TAX: {
    regime: "US_SALES_TAX",
    displayName: "United States — Sales Tax",
    defaultMode: "EXCLUSIVE",
    taxLabel: "Sales Tax",
    taxIdLabel: "Sales Tax / EIN",
    splitCgstSgst: false,
    exampleRates: "Varies by state/city — commonly 6–10%",
    defaultCountry: "US",
  },
  EU_VAT: {
    regime: "EU_VAT",
    displayName: "European Union — VAT",
    defaultMode: "INCLUSIVE",
    taxLabel: "VAT",
    taxIdLabel: "VAT No.",
    splitCgstSgst: false,
    exampleRates: "Reduced rate often applies to dine-in food, e.g. 10% Germany / 10% Italy",
    defaultCountry: "DE",
  },
  ES_IVA: {
    regime: "ES_IVA",
    displayName: "Spain — IVA",
    defaultMode: "INCLUSIVE",
    taxLabel: "IVA",
    taxIdLabel: "NIF/CIF",
    splitCgstSgst: false,
    exampleRates: "10% (hospitality reduced rate) / 21% (general rate)",
    defaultCountry: "ES",
  },
  CUSTOM: {
    regime: "CUSTOM",
    displayName: "Custom",
    defaultMode: "INCLUSIVE",
    taxLabel: "Tax",
    taxIdLabel: "Tax ID",
    splitCgstSgst: false,
    exampleRates: "Set per menu item",
    defaultCountry: "IN",
  },
};

/** Effective receipt label for a branch: explicit taxLabel override wins, else the regime preset's. */
export function resolveTaxLabel(taxRegime: TaxRegime, taxLabel?: string | null): string {
  return taxLabel?.trim() || TAX_REGIME_PRESETS[taxRegime].taxLabel;
}

/** Effective tax-id field label for a branch. */
export function resolveTaxIdLabel(taxRegime: TaxRegime): string {
  return TAX_REGIME_PRESETS[taxRegime].taxIdLabel;
}

export const branchTaxSettingsSchema = z.object({
  country: z.string().length(2).optional(),
  taxRegime: z.enum(TAX_REGIMES).optional(),
  taxMode: z.enum(TAX_MODES).optional(),
  taxLabel: z.string().max(30).optional().nullable(),
  taxId: z.string().max(50).optional().nullable(),
});
export type BranchTaxSettingsDto = z.infer<typeof branchTaxSettingsSchema>;

// ---------------------------------------------------------------------------
// India GST fields (2026-11-09). Shown and printed only when the branch
// regime is INDIA_GST. An empty string means "not set" (forms send "" or
// null to clear a value).
// ---------------------------------------------------------------------------

/** HSN/SAC code: digits only, 4 to 8 characters. */
export const HSN_SAC_PATTERN = /^\d{4,8}$/;
export function isValidHsnSac(value: string): boolean {
  return HSN_SAC_PATTERN.test(value);
}
/** FSSAI licence / registration number: exactly 14 digits. */
export const FSSAI_PATTERN = /^\d{14}$/;
export function isValidFssai(value: string): boolean {
  return FSSAI_PATTERN.test(value);
}
/** Optional HSN/SAC: empty clears it, otherwise 4-8 digits. */
export const hsnSacSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidHsnSac(v), "HSN/SAC must be 4 to 8 digits")
  .nullable()
  .optional();
/** Optional FSSAI number: empty clears it, otherwise exactly 14 digits. */
export const fssaiSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidFssai(v), "FSSAI number must be exactly 14 digits")
  .nullable()
  .optional();

/** GST state / union territory codes (first two digits of a GSTIN). */
export const INDIA_STATES: readonly { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];
export function isIndiaStateCode(code: string): boolean {
  return INDIA_STATES.some((s) => s.code === code);
}
export function indiaStateName(code: string | null | undefined): string | null {
  return INDIA_STATES.find((s) => s.code === code)?.name ?? null;
}

/** GSTIN: 2-digit state code, PAN, entity number, "Z", check character. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function isValidGstin(value: string): boolean {
  const v = value.trim().toUpperCase();
  return GSTIN_PATTERN.test(v) && isIndiaStateCode(v.slice(0, 2));
}
/** State code from a GSTIN (first two digits), or null if it is not a valid GSTIN. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin || !isValidGstin(gstin)) return null;
  return gstin.trim().slice(0, 2);
}

export interface GstTaxLine {
  label: "CGST" | "SGST" | "IGST";
  amount: number;
}

/**
 * The ONE place that decides how an India GST amount is shown: IGST (the
 * full amount on one line) when the place of supply is set and is a
 * different state from the branch, otherwise CGST + SGST halves. Rounding:
 * CGST is the half rounded to paise, SGST is the remainder, so the lines
 * always add up to the tax amount exactly. Used by both receipts (HTML and
 * thermal) and the POS bill totals.
 */
export function splitIndiaGst(
  taxAmount: number,
  opts: { branchStateCode: string | null | undefined; placeOfSupplyStateCode?: string | null },
): GstTaxLine[] {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const total = round2(taxAmount);
  const { branchStateCode, placeOfSupplyStateCode } = opts;
  if (placeOfSupplyStateCode && branchStateCode && placeOfSupplyStateCode !== branchStateCode) {
    return [{ label: "IGST", amount: total }];
  }
  const half = round2(total / 2);
  return [
    { label: "CGST", amount: half },
    { label: "SGST", amount: round2(total - half) },
  ];
}
