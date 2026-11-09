import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  extendTrialSchema,
  platformRestaurantListQuerySchema,
  suspendRestaurantSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PlatformService } from './platform.service';

// Every route: UDYOG platform admins only (PlatformAdminGuard).
@ApiTags('platform')
@Controller('v1/platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @PlatformAdmin()
  @Get('restaurants')
  list(@Query() query: Record<string, string>) {
    const parsed = platformRestaurantListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: parsed.error.issues,
      });
    }
    return this.platform.list(parsed.data);
  }

  @PlatformAdmin()
  @Post('restaurants/:id/suspend')
  @UsePipes(new ZodValidationPipe(suspendRestaurantSchema))
  suspend(
    @CurrentUser() admin: SessionUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.suspend(admin, id, (body ?? {}) as never);
  }

  @PlatformAdmin()
  @Post('restaurants/:id/unsuspend')
  unsuspend(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.platform.unsuspend(admin, id);
  }

  @PlatformAdmin()
  @Post('restaurants/:id/extend-trial')
  @UsePipes(new ZodValidationPipe(extendTrialSchema))
  extendTrial(
    @CurrentUser() admin: SessionUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.platform.extendTrial(admin, id, body as never);
  }

  @PlatformAdmin()
  @Post('restaurants/:id/mark-active')
  markActive(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.platform.markActive(admin, id);
  }
}
