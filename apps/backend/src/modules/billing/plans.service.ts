import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Plan, Prisma } from '@prisma/client';
import type { CreatePlanDto, UpdatePlanDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { gstOnPaise, gstRatePercent } from './billing-config';
import { RazorpayService } from './razorpay.service';

type Cycle = 'monthly' | 'yearly';
const PRICE_FIELD = {
  monthly: 'priceMonthlyPaise',
  yearly: 'priceYearlyPaise',
} as const;
const RZ_FIELD = {
  monthly: 'razorpayPlanIdMonthly',
  yearly: 'razorpayPlanIdYearly',
} as const;

/**
 * Platform admin plan management. Razorpay plans are immutable, so whenever a
 * price is set or changed a NEW Razorpay plan (price + GST) is created and
 * stored; existing subscribers stay on the Razorpay plan they started with.
 * Without Razorpay keys or GST_RATE_PERCENT the price is saved, the Razorpay
 * plan id stays empty, and the warnings say why.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {}

  list() {
    return this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreatePlanDto) {
    const exists = await this.prisma.plan.findUnique({
      where: { code: dto.code },
    });
    if (exists)
      throw new ConflictException('A plan with this code already exists');
    const plan = await this.prisma.plan.create({
      data: {
        code: dto.code,
        name: dto.name,
        priceMonthlyPaise: dto.priceMonthlyPaise ?? null,
        priceYearlyPaise: dto.priceYearlyPaise ?? null,
        maxBranches: dto.maxBranches ?? null,
        maxUsers: dto.maxUsers ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return this.syncRazorpayPlans(plan, ['monthly', 'yearly']);
  }

  async update(id: string, dto: UpdatePlanDto) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found');
    const changed: Cycle[] = (['monthly', 'yearly'] as const).filter(
      (c) =>
        dto[PRICE_FIELD[c]] !== undefined &&
        dto[PRICE_FIELD[c]] !== before[PRICE_FIELD[c]],
    );
    // The old Razorpay plan matches the old price: drop it on a price change
    // so nobody can subscribe at the old amount.
    const clear: Prisma.PlanUpdateInput = {};
    for (const c of changed) clear[RZ_FIELD[c]] = null;
    const plan = await this.prisma.plan.update({
      where: { id },
      data: { ...dto, ...clear },
    });
    return this.syncRazorpayPlans(plan, changed);
  }

  /** Creates Razorpay plans for the given cycles that have a price but no plan id. */
  private async syncRazorpayPlans(plan: Plan, cycles: Cycle[]) {
    const warnings = new Set<string>();
    const rate = gstRatePercent();
    const data: Prisma.PlanUpdateInput = {};
    for (const c of cycles) {
      const price = plan[PRICE_FIELD[c]];
      if (price === null || plan[RZ_FIELD[c]]) continue;
      if (!this.razorpay.isConfigured()) warnings.add('Razorpay keys missing');
      if (rate === null) warnings.add('GST rate missing');
      if (!this.razorpay.isConfigured() || rate === null) continue;
      try {
        data[RZ_FIELD[c]] = await this.razorpay.createPlan({
          period: c,
          name: `${plan.name} (${c})`,
          amountPaise: price + gstOnPaise(price, rate),
          planCode: plan.code,
        });
      } catch (e) {
        warnings.add(
          `Razorpay plan (${c}) not created: ${e instanceof Error ? e.message : 'error'}`,
        );
      }
    }
    const saved = Object.keys(data).length
      ? await this.prisma.plan.update({ where: { id: plan.id }, data })
      : plan;
    return { plan: saved, warnings: [...warnings] };
  }
}
