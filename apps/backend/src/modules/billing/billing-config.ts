import { isValidGstin, isValidHsnSac } from '@nodedr-restaurant/types';

// Billing settings come ONLY from env. Nothing is defaulted except
// GRACE_DAYS (3). Read on every call so a restart is the only "deploy".

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
}

export function razorpayKeys(env = process.env): RazorpayKeys | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export function webhookSecret(env = process.env): string | null {
  return env.RAZORPAY_WEBHOOK_SECRET?.trim() || null;
}

/** Days of access kept after a failed renewal; non-negative integer, default 3. */
export function graceDays(env = process.env): number {
  const raw = env.GRACE_DAYS?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : 3;
}

/** GST rate for UDYOG's own charges, e.g. "18"; null when unset or invalid. */
export function gstRatePercent(env = process.env): number | null {
  const raw = env.GST_RATE_PERCENT?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export interface CompanyDetails {
  name: string;
  gstin: string;
  address: string;
  sac: string;
  stateCode: string;
  gstRatePercent: number;
}

/** Seller details for GST invoices; null if any is missing (no invoice then). */
export function companyDetails(env = process.env): CompanyDetails | null {
  const name = env.COMPANY_NAME?.trim();
  const gstin = env.COMPANY_GSTIN?.trim().toUpperCase();
  const address = env.COMPANY_ADDRESS?.trim();
  const sac = env.SUBSCRIPTION_SAC?.trim();
  const rate = gstRatePercent(env);
  if (!name || !gstin || !address || !sac || rate === null) return null;
  if (!isValidGstin(gstin) || !isValidHsnSac(sac)) return null;
  return {
    name,
    gstin,
    address,
    sac,
    stateCode: gstin.slice(0, 2),
    gstRatePercent: rate,
  };
}

/** GST on a price excl. GST, rounded to the paisa. */
export function gstOnPaise(pricePaise: number, ratePercent: number): number {
  return Math.round((pricePaise * ratePercent) / 100);
}

/** Split a GST-inclusive amount into taxable value + tax (paise). */
export function splitInclusivePaise(
  amountPaise: number,
  ratePercent: number | null,
): { taxableValuePaise: number; taxPaise: number } {
  if (ratePercent === null || ratePercent === 0) {
    return { taxableValuePaise: amountPaise, taxPaise: 0 };
  }
  const taxable = Math.round((amountPaise * 100) / (100 + ratePercent));
  return { taxableValuePaise: taxable, taxPaise: amountPaise - taxable };
}
