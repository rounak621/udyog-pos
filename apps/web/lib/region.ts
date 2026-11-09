/**
 * Spain-only features (VERI*FACTU) apply when the branch is in Spain or uses
 * the Spain IVA tax regime. Used to hide the settings tab and guard its page.
 */
export function isSpainBranch(branch: { country?: string | null; taxRegime?: string | null } | null | undefined): boolean {
  return branch?.country === "ES" || branch?.taxRegime === "ES_IVA";
}
