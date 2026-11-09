// SSRF protection for webhook targets. A restaurant admin chooses the URL, so
// without this a malicious or compromised admin could make the server call
// internal services (cloud metadata, the database host, other containers).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => acc * 256 + Number(p), 0);
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (kind === 6) {
    const g = expandIpv6(ip);
    if (!g) return true; // unparseable: refuse
    // IPv4 inside IPv6 takes the IPv4 rules, in any spelling (the URL parser
    // turns ::ffff:127.0.0.1 into ::ffff:7f00:1): mapped (::ffff:0:0/96),
    // compatible (::/96, which also covers :: and ::1), NAT64 (64:ff9b::/96)
    // and 6to4 (2002::/16).
    const v4 = (hi: number, lo: number) =>
      `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0))
      return isPrivateAddress(v4(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
      return isPrivateAddress(v4(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateAddress(v4(g[1], g[2]));
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP at all: refuse
}

/** IPv6 text (any valid spelling, incl. a trailing dotted quad) to 8 groups. */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, ''); // drop a zone id
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = ipv4ToInt(dotted[1]);
    s = `${s.slice(0, -dotted[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail, extra] = s.split('::');
  if (extra !== undefined) return null;
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0) return null;
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t].map((x) =>
    /^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN,
  );
  return groups.length === 8 && groups.every((x) => !Number.isNaN(x))
    ? groups
    : null;
}

export interface WebhookNetOptions {
  allowPrivate: boolean;
  allowInsecure: boolean;
}

export function netOptionsFromEnv(env = process.env): WebhookNetOptions {
  return {
    allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE === 'true',
    allowInsecure: env.WEBHOOKS_ALLOW_INSECURE === 'true',
  };
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

/**
 * Parses and resolves a webhook URL, refusing non-HTTPS (unless allowed) and
 * any host that resolves to a private address. The returned address is what
 * the request must connect to, so DNS cannot change between this check and
 * the connection (DNS rebinding).
 */
export async function resolveWebhookTarget(
  raw: string,
  opts: WebhookNetOptions,
  resolve: (host: string) => Promise<{ address: string; family: number }[]> = (
    h,
  ) => lookup(h, { all: true }),
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL');
  }
  if (
    url.protocol !== 'https:' &&
    !(opts.allowInsecure && url.protocol === 'http:')
  )
    throw new Error('Webhook URLs must use https');
  if (url.username || url.password)
    throw new Error('Put credentials in the signature secret, not the URL');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolve(host).catch(() => {
        throw new Error('Could not resolve that host');
      });
  if (addresses.length === 0) throw new Error('Could not resolve that host');
  if (!opts.allowPrivate && addresses.some((a) => isPrivateAddress(a.address)))
    throw new Error('That address points to a private or internal network');

  const first = addresses[0];
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}
