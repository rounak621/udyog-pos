import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  gstinStateCode,
  type BranchConfig,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

// Roles that run the whole restaurant see every branch of it; everyone else
// sees only the branches they were assigned to (UserBranch).
const ALL_BRANCH_ROLES = ['OWNER', 'ADMINISTRATOR'];

// Branch managers (settings.manage) get full rows as before. Everyone else
// gets only these fields: no kiosk token, no printer host/port/connection.
// The web app reads only id and name from this list (hooks/use-branch.tsx);
// kiosk and printer settings come from GET /settings (settings.manage).
const SAFE_BRANCH_FIELDS = {
  id: true,
  restaurantId: true,
  name: true,
  address: true,
  phone: true,
  country: true,
  taxRegime: true,
  taxMode: true,
  isActive: true,
} as const;

@ApiTags('branches')
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  @Auth()
  @Get()
  listBranches(@CurrentUser() user: SessionUser) {
    const where = {
      restaurantId: user.restaurantId,
      isActive: true,
      ...this.visibleTo(user),
    };
    if (user.permissions.includes('settings.manage')) {
      return this.prisma.branch.findMany({ where, orderBy: { name: 'asc' } });
    }
    return this.prisma.branch.findMany({
      where,
      orderBy: { name: 'asc' },
      select: SAFE_BRANCH_FIELDS,
    });
  }

  /**
   * What an app needs to show prices and India GST details for the branch it
   * works in. Any signed-in user of that branch; read only; no secrets.
   */
  @Auth()
  @Get('current-config')
  async currentConfig(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ): Promise<BranchConfig> {
    if (!branchId) throw new NotFoundException('Branch not found');
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        restaurantId: user.restaurantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        country: true,
        taxRegime: true,
        taxMode: true,
        taxLabel: true,
        taxId: true,
        gstNumber: true,
        fssaiNumber: true,
        defaultHsnSac: true,
        invoicePrefix: true,
        restaurant: {
          select: {
            name: true,
            currency: true,
            timezone: true,
            logoUrl: true,
            upiVpa: true,
            upiPayeeName: true,
          },
        },
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    if (!ALL_BRANCH_ROLES.includes(user.roleName)) {
      const assigned = await this.prisma.userBranch.findUnique({
        where: { userId_branchId: { userId: user.id, branchId } },
        select: { branchId: true },
      });
      if (!assigned)
        throw new ForbiddenException('Not assigned to this branch');
    }
    const isIndia = branch.taxRegime === 'INDIA_GST';
    const gstin = branch.taxId || branch.gstNumber || null;
    return {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      country: branch.country,
      taxRegime: branch.taxRegime,
      taxMode: branch.taxMode,
      taxLabel: branch.taxLabel,
      restaurantName: branch.restaurant.name,
      logoUrl: branch.restaurant.logoUrl,
      currency: branch.restaurant.currency,
      timezone: branch.restaurant.timezone,
      upiVpa: branch.restaurant.upiVpa,
      upiPayeeName: branch.restaurant.upiPayeeName,
      india: isIndia
        ? {
            gstin,
            stateCode: gstinStateCode(gstin),
            fssaiNumber: branch.fssaiNumber,
            defaultHsnSac: branch.defaultHsnSac,
            invoicePrefix: branch.invoicePrefix,
          }
        : null,
    };
  }

  private visibleTo(user: SessionUser) {
    return ALL_BRANCH_ROLES.includes(user.roleName)
      ? {}
      : { users: { some: { userId: user.id } } };
  }
}
