import { NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Fixed, server-side whitelist: the ONLY URLs this endpoint will ever
// redirect to. The client sends a channel key (an enum-like string, never a
// URL), so this can never become an open redirect — see the security
// hardening report's "unsafe URL handling / open redirects" check, which
// this is deliberately built to keep passing.
// The base comes from DOWNLOADS_BASE_URL (operator-set env, empty by
// default); with it unset there are no channels at all.
function downloadChannels(): Record<string, string> {
  const base = (process.env.DOWNLOADS_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!base) return {};
  return {
    github: base,
    'install-script': `${base}/raw/master/install.sh`,
    docker: `${base}#one-click-install`,
    casaos: 'https://github.com/IceWhaleTech/CasaOS-AppStore',
  };
}

export type DownloadChannel = string;

@Injectable()
export class DownloadsService {
  constructor(private readonly prisma: PrismaService) {}

  resolveChannel(channel: string): string {
    const url = downloadChannels()[channel];
    if (!url) throw new NotFoundException('Unknown download channel');
    return url;
  }

  async recordAndResolve(channel: string): Promise<string> {
    const url = this.resolveChannel(channel);
    await this.prisma.downloadStat.upsert({
      where: { channel },
      create: { channel, count: 1 },
      update: { count: { increment: 1 } },
    });
    return url;
  }

  async stats(): Promise<{ channel: string; count: number }[]> {
    const channels = downloadChannels();
    if (Object.keys(channels).length === 0) return [];
    const rows = await this.prisma.downloadStat.findMany({
      orderBy: { channel: 'asc' },
    });
    // Always report every known channel, even ones with zero clicks yet —
    // an honest, complete picture rather than only rows that happen to
    // exist in the DB.
    const byChannel = new Map(rows.map((r) => [r.channel, r.count]));
    return Object.keys(channels).map((channel) => ({
      channel,
      count: byChannel.get(channel) ?? 0,
    }));
  }
}
