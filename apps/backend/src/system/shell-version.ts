// The UDYOG POS Windows app appends "UDYOGPOS-Shell/<version>" to its user
// agent (windows/msix/Launcher/ShellWindow.cs). Versions are numeric dotted
// (x.y.z, the shell sends x.y.z.w); missing parts count as 0.

const VERSION_RE = /^\d+(\.\d+){0,3}$/;
const SHELL_TOKEN_RE = /UDYOGPOS-Shell\/(\d+(?:\.\d+){0,3})/;

export function parseShellVersion(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  const match = SHELL_TOKEN_RE.exec(userAgent);
  return match ? match[1] : null;
}

export function isValidVersion(value: string | undefined | null): value is string {
  return typeof value === 'string' && VERSION_RE.test(value.trim());
}

/** -1 when a < b, 0 when equal, 1 when a > b. Both must be valid versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().split('.').map(Number);
  const pb = b.trim().split('.').map(Number);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export interface ShellCheck {
  shellVersion: string | null;
  minVersion: string | null;
  updateRequired: boolean;
}

/**
 * updateRequired only when the request came from the shell (token present),
 * a valid minimum is configured, and the shell is older than it. A normal
 * browser (no token) is never asked to update.
 */
export function shellCheck(
  userAgent: string | undefined | null,
  minVersionSetting: string | undefined | null,
): ShellCheck {
  const shellVersion = parseShellVersion(userAgent);
  const minVersion = isValidVersion(minVersionSetting) ? minVersionSetting.trim() : null;
  const updateRequired =
    shellVersion !== null &&
    minVersion !== null &&
    compareVersions(shellVersion, minVersion) < 0;
  return { shellVersion, minVersion, updateRequired };
}
