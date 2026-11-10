import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { shellCheck, type ShellCheck } from './shell-version';

@ApiTags('system')
@Controller('v1/system')
export class ShellCheckController {
  // Any signed-in user: the desktop app asks whether it is too old for this
  // server (MIN_SHELL_VERSION). Never blocks; the web shows a banner.
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @Get('shell-check')
  check(@Headers('user-agent') userAgent?: string): ShellCheck {
    return shellCheck(userAgent, process.env.MIN_SHELL_VERSION);
  }
}
