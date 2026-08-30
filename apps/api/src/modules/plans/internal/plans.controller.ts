import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { planCodeSchema, type PlanTier, type PlanUsage, type Subscription } from '@mir/contracts';
import { PublicEndpoint, RequiresRole } from '../../../shared/authz/access-metadata';
import { PlansService } from './plans.service';

/**
 * Plans and subscriptions — brief §2, §5.7.
 *
 * `GET /plans` IS PUBLIC, and that is the whole reason the catalogue is read
 * through a definer function: a price list is marketing material shown to
 * visitors who have no session, and there is nothing in it to protect. It
 * returns tiers and nothing else — no subscription, no organisation, and no
 * count of who is on which tier.
 */

const changeSchema = z.object({ planCode: planCodeSchema });

@Controller()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @PublicEndpoint()
  @Get('plans')
  async catalogue(): Promise<{ plans: PlanTier[] }> {
    return { plans: await this.plans.catalogue() };
  }

  @RequiresRole('applicant', 'libya_doctor', 'tunisia_doctor', 'admin')
  @Get('subscriptions/mine')
  async mine(): Promise<{ subscription: Subscription | null; usage: PlanUsage }> {
    return this.plans.mine();
  }

  /**
   * Records the intent to be on a tier. It TAKES NO MONEY — blocking item L7 is
   * unresolved and no payment rail is wired. 204 rather than a receipt, because
   * there is nothing to receipt.
   */
  @RequiresRole('libya_doctor', 'tunisia_doctor')
  @Post('subscriptions')
  @HttpCode(204)
  async change(@Body() body: unknown): Promise<void> {
    await this.plans.changePlan(changeSchema.parse(body).planCode);
  }
}
