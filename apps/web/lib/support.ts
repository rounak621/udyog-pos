// Support email for "Help & support" (user menu) and the account-blocked page.
// Inlined at build time (NEXT_PUBLIC_). Empty or unset = no support link.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? "";
