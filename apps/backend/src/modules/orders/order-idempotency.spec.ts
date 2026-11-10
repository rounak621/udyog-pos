import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { allocateInvoiceNumber } from './invoice-number';

jest.mock('./invoice-number', () => ({
  allocateInvoiceNumber: jest.fn().mockResolvedValue({
    invoiceNo: 'INV/2627/000001',
    invoiceSeriesId: 's1',
    invoiceIssuedAt: new Date('2026-11-10T10:00:00Z'),
    invoiceRestaurantId: 'r1',
  }),
}));
const allocateMock = allocateInvoiceNumber as jest.Mock;

type Overridable = Record<string, unknown>;

function makeService(prisma: unknown) {
  const deps = {
    realtime: { emitToBranch: jest.fn() },
    inventory: { deductForOrder: jest.fn().mockResolvedValue({ skipped: [] }) },
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    notifications: { notifyByPermission: jest.fn() },
    webhooks: { emitForBranch: jest.fn().mockResolvedValue(undefined) },
    verifactu: { recordPaidOrder: jest.fn().mockResolvedValue(undefined) },
  };
  const service = new OrdersService(
    prisma as never,
    deps.realtime as never,
    {} as never,
    deps.inventory as never,
    deps.audit as never,
    deps.notifications as never,
    {} as never,
    deps.webhooks as never,
    deps.verifactu as never,
  );
  return { service, deps, internals: service as unknown as Overridable };
}

const newOrderDto = {
  type: 'TAKEAWAY',
  items: [{ menuItemId: 'm1', quantity: 1, modifierIds: [] }],
} as never;

describe('idempotent staff order creation', () => {
  beforeEach(() => allocateMock.mockClear());

  it('a repeated clientRequestId returns the existing order and creates nothing', async () => {
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }) },
      $transaction: jest.fn(),
    };
    const { service, deps, internals } = makeService(prisma);
    internals.getOrder = jest.fn().mockResolvedValue({ id: 'o1', orderNumber: '20261110-0001' });

    const res = await service.createOrder('b1', 'u1', newOrderDto, {
      clientRequestId: '6f1c2c8e-7d1b-4b7a-9a43-1f2e3d4c5b6a',
    });

    expect(res).toMatchObject({ id: 'o1' });
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId: 'b1', clientRequestId: '6f1c2c8e-7d1b-4b7a-9a43-1f2e3d4c5b6a' },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(deps.realtime.emitToBranch).not.toHaveBeenCalled();
    expect(deps.notifications.notifyByPermission).not.toHaveBeenCalled();
  });

  it('a P2002 race on clientRequestId returns the order the other request created', async () => {
    const prisma = {
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // not there yet when this request starts
          .mockResolvedValueOnce({ id: 'o9' }), // the winner, after the unique violation
      },
      menuItem: { findMany: jest.fn().mockResolvedValue([{ id: 'm1' }]) },
      modifier: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    };
    const { service, deps, internals } = makeService(prisma);
    internals.getBranchTaxMode = jest.fn().mockResolvedValue('INCLUSIVE');
    internals.getBranchDefaultHsnSac = jest.fn().mockResolvedValue(null);
    internals.validateModifierSelections = jest.fn().mockResolvedValue(undefined);
    internals.buildLine = jest.fn().mockReturnValue({
      menuItem: { id: 'm1', name: 'Tea', price: 10, taxRatePercent: 5, hsnSac: null },
      cartItem: { menuItemId: 'm1', quantity: 1, modifierIds: [] },
      priced: { lineTotal: 10, taxAmount: 0.48 },
      selectedModifiers: [],
    });
    internals.getOrder = jest.fn().mockResolvedValue({ id: 'o9', orderNumber: '20261110-0002' });

    const res = await service.createOrder('b1', 'u1', newOrderDto, {
      clientRequestId: '0b7f4e0e-1d0c-4c2e-8f5a-2a1b3c4d5e6f',
    });

    expect(res).toMatchObject({ id: 'o9' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(deps.realtime.emitToBranch).not.toHaveBeenCalled();
  });
});

describe('invoice number at checkout', () => {
  beforeEach(() => allocateMock.mockClear());

  const openOrder = {
    id: 'o1',
    status: 'OPEN',
    acceptance: 'NOT_REQUIRED',
    invoiceNo: null,
    payments: [],
    items: [],
    customerId: null,
    customer: null,
    tableId: null,
    loyaltyPointsRedeemed: 0,
    loyaltyDiscountAmount: 0,
  };

  function checkoutSetup() {
    const tx = { order: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(openOrder),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...openOrder,
          orderNumber: '20261110-0001',
          payments: [],
          table: null,
        }),
      },
      branch: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          taxRegime: 'INDIA_GST',
          restaurantId: 'r1',
          invoicePrefix: null,
          restaurant: { loyaltyEarnPerCurrency: 100 },
        }),
      },
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    };
    const { service, internals } = makeService(prisma);
    internals.resolveBill = jest.fn().mockResolvedValue({
      bill: {
        totalDue: 100,
        subtotal: 100,
        discountAmount: 0,
        taxAmount: 4.76,
        tipAmount: 0,
        loyaltyDiscountAmount: 0,
      },
      locked: false,
      paid: 0,
      auto: {},
      pointsToRedeem: 0,
    });
    internals.releaseTableIfIdle = jest.fn().mockResolvedValue(undefined);
    return { service, prisma, tx, internals };
  }

  it('a replayed checkout returns the stored result and allocates nothing', async () => {
    const { service, prisma, internals } = checkoutSetup();
    prisma.order.findFirst.mockResolvedValue({
      ...openOrder,
      status: 'PAID',
      invoiceNo: 'INV/2627/000001',
      payments: [{ clientRequestId: 'req-12345678' }],
    });
    internals.checkoutResult = jest.fn().mockResolvedValue({ id: 'o1', invoiceNo: 'INV/2627/000001' });

    const res = await service.checkout('b1', 'o1', 'u1', {
      payments: [{ method: 'CASH', amount: 100 }],
      requestId: 'req-12345678',
    } as never);

    expect(res).toMatchObject({ invoiceNo: 'INV/2627/000001' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(allocateMock).not.toHaveBeenCalled();
  });

  it('a partial payment allocates no number; the payment that settles the bill allocates exactly one', async () => {
    const partial = checkoutSetup();
    await partial.service.checkout('b1', 'o1', 'u1', {
      payments: [{ method: 'CASH', amount: 40 }],
      allowPartial: true,
    } as never);
    expect(allocateMock).not.toHaveBeenCalled();
    const partialData = partial.tx.order.update.mock.calls[0][0].data;
    expect(partialData.invoiceNo).toBeUndefined();
    expect(partialData.status).toBeUndefined();

    const full = checkoutSetup();
    await full.service.checkout('b1', 'o1', 'u1', {
      payments: [{ method: 'CASH', amount: 100 }],
    } as never);
    expect(allocateMock).toHaveBeenCalledTimes(1);
    expect(allocateMock).toHaveBeenCalledWith(full.tx, {
      restaurantId: 'r1',
      branchId: 'b1',
      prefix: null,
    });
    const paidData = full.tx.order.update.mock.calls[0][0].data;
    expect(paidData).toMatchObject({ status: 'PAID', invoiceNo: 'INV/2627/000001' });
  });
});
