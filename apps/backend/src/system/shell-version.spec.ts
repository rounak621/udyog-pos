import { compareVersions, parseShellVersion, shellCheck } from './shell-version';

const SHELL_UA = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Edg/131.0 UDYOGPOS-Shell/1.2.0.0';

describe('shell version check', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.2.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0.0')).toBe(0);
    expect(compareVersions('2.0', '1.99.99')).toBe(1);
    expect(compareVersions('0.1.0.0', '0.1.0.1')).toBe(-1);
  });

  it('reads the shell token from the user agent', () => {
    expect(parseShellVersion(SHELL_UA)).toBe('1.2.0.0');
    expect(parseShellVersion('Mozilla/5.0 Chrome/131.0')).toBeNull();
    expect(parseShellVersion(undefined)).toBeNull();
  });

  it('updateRequired only for a shell older than the minimum', () => {
    // No token (normal browser) -> false, even with a minimum set.
    expect(shellCheck('Mozilla/5.0 Chrome/131.0', '9.0.0').updateRequired).toBe(false);
    // No minimum -> false.
    expect(shellCheck(SHELL_UA, undefined)).toEqual({ shellVersion: '1.2.0.0', minVersion: null, updateRequired: false });
    // Invalid minimum is treated as unset.
    expect(shellCheck(SHELL_UA, 'latest').updateRequired).toBe(false);
    // Older -> true.
    expect(shellCheck(SHELL_UA, '1.3.0').updateRequired).toBe(true);
    // Equal -> false; newer -> false.
    expect(shellCheck(SHELL_UA, '1.2.0').updateRequired).toBe(false);
    expect(shellCheck(SHELL_UA, '1.1.9').updateRequired).toBe(false);
  });
});
