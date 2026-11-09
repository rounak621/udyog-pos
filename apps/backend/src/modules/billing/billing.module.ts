import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BillingReconcileService } from './billing-reconcile.service';
import { BillingWebhookService } from './billing-webhook.service';
import {
  BillingController,
  BillingWebhookController,
  PlatformPlansController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';
import { RazorpayService } from './razorpay.service';

@Module({
  imports: [AuditModule],
  controllers: [
    PlatformPlansController,
    BillingController,
    BillingWebhookController,
  ],
  providers: [
    RazorpayService,
    PlansService,
    BillingService,
    BillingWebhookService,
    BillingReconcileService,
  ],
})
export class BillingModule {}
