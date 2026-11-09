import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UsePipes,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createPlanSchema,
  subscribeSchema,
  updatePlanSchema,
  verifyCheckoutSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import type { Request } from 'express';
import { AllowWhenExpired } from '../../common/decorators/allow-when-expired.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';

/** Platform admins: manage plans (prices excl. GST, limits). */
@ApiTags('platform')
@Controller('v1/platform/plans')
export class PlatformPlansController {
  constructor(private readonly plans: PlansService) {}

  @PlatformAdmin()
  @Get()
  list() {
    return this.plans.list();
  }

  @PlatformAdmin()
  @Post()
  @UsePipes(new ZodValidationPipe(createPlanSchema))
  create(@Body() body: unknown) {
    return this.plans.create(body as never);
  }

  @PlatformAdmin()
  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updatePlanSchema))
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.plans.update(id, body as never);
  }
}

/** Restaurant owners: their own subscription. Reachable after a trial/plan expires. */
@ApiTags('billing')
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Auth('billing.manage')
  @AllowWhenExpired()
  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @Auth('billing.manage')
  @AllowWhenExpired()
  @Get('status')
  status(@CurrentUser() user: SessionUser) {
    return this.billing.status(user.restaurantId);
  }

  @Auth('billing.manage')
  @AllowWhenExpired()
  @Post('subscribe')
  @UsePipes(new ZodValidationPipe(subscribeSchema))
  subscribe(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.billing.subscribe(user, body as never);
  }

  @Auth('billing.manage')
  @AllowWhenExpired()
  @Post('verify')
  @UsePipes(new ZodValidationPipe(verifyCheckoutSchema))
  verify(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.billing.verify(user, body as never);
  }

  @Auth('billing.manage')
  @AllowWhenExpired()
  @Post('cancel')
  cancel(@CurrentUser() user: SessionUser) {
    return this.billing.cancel(user);
  }
}

/** Razorpay -> UDYOG. Public (no login); authenticated by its signature. */
@ApiTags('billing')
@Controller('v1/billing/webhook')
export class BillingWebhookController {
  constructor(private readonly webhook: BillingWebhookService) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post()
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    // rawBody: NestFactory.create(..., { rawBody: true }) in main.ts.
    return this.webhook.handle(req.rawBody, signature, eventId);
  }
}
