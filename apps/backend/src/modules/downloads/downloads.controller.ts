import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator';
import { DownloadsService } from './downloads.service';

// Deliberately unauthenticated and public — these are the marketing site's
// "Download" / "Get started" buttons. No @Auth() here on purpose.
@ApiTags('downloads')
@Controller('v1/downloads')
export class DownloadsController {
  constructor(private readonly downloads: DownloadsService) {}

  // Click counts are platform data (all installs on this server), so only
  // UDYOG platform admins can read them. The redirect below stays public.
  @PlatformAdmin()
  @Get('stats')
  stats() {
    return this.downloads.stats();
  }

  // Throttled well below the app-wide default — this is unauthenticated
  // and its only job is a cheap counter increment + redirect, an easy spam
  // target if left at the generous 300/min global limit.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('go/:channel')
  async go(@Param('channel') channel: string, @Res() res: Response) {
    const url = await this.downloads.recordAndResolve(channel);
    res.redirect(302, url);
  }
}
