import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@nodedr-restaurant/types';
import { OrdersController } from './orders.controller';
import { KotPrintService } from './kot-print.service';
import { sendToBranchPrinter } from './printer-transport';

// No hardware, no network: the server-print transport is a mock.
jest.mock('./printer-transport', () => ({
  sendToBranchPrinter: jest.fn().mockResolvedValue(undefined),
}));
const sendMock = sendToBranchPrinter as jest.Mock;

const ESC_INIT = Buffer.from([0x1b, 0x40]);
const DRAWER_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

const user = {
  id: 'u1',
  restaurantId: 'r1',
  permissions: ['bills.print', 'orders.create'],
} as unknown as SessionUser;

function paidOrder() {
  return {
    id: 'o1',
    orderNumber: 'A-1',
    type: 'DINE_IN',
    createdAt: new Date('2026-11-10T10:00:00Z'),
    table: null,
    customer: null,
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 0,
    tipAmount: 0,
    loyaltyPointsRedeemed: 0,
    loyaltyDiscountAmount: 0,
    totalAmount: 100,
    customerGstin: null,
    placeOfSupplyStateCode: null,
    items: [
      {
        nameSnapshot: 'Masala Dosa',
        quantity: 1,
        unitPriceSnapshot: 100,
        lineTotal: 100,
        taxRateSnapshot: 0,
        hsnSacSnapshot: null,
        modifiers: [],
      },
    ],
    payments: [{ method: 'CASH', amount: 100, tendered: 100, changeGiven: 0 }],
    branch: {
      name: 'Main',
      address: null,
      phone: null,
      gstNumber: null,
      taxRegime: 'CUSTOM',
      taxMode: 'EXCLUSIVE',
      taxLabel: 'Tax',
      taxId: null,
      fssaiNumber: null,
      printerPaperWidthMm: 80,
      printerCodepage: 'CP858',
      printerColumns: null,
      printerConnection: 'USB',
      printerHost: null,
      printerPort: 9100,
      restaurant: { name: 'Test Restaurant', currency: 'INR' },
    },
  };
}

function makeController() {
  const ordersService = {
    getBillForPrint: jest.fn().mockResolvedValue({
      order: paidOrder(),
      overrides: { isProvisional: false },
    }),
    recordBillPrinted: jest.fn(),
    printerProfile: jest.fn(),
    printerTarget: jest.fn().mockResolvedValue({
      printerConnection: 'USB',
      printerHost: null,
      printerPort: 9100,
    }),
  };
  const branchAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
  const verifactu = { qrForOrder: jest.fn().mockResolvedValue(null) };
  const controller = new OrdersController(
    ordersService as never,
    branchAccess as never,
    {} as never,
    verifactu as never,
  );
  return { controller, ordersService };
}

describe('ESC/POS byte endpoints and server-print gate', () => {
  const saved = process.env.ALLOW_SERVER_PRINT;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOW_SERVER_PRINT;
    else process.env.ALLOW_SERVER_PRINT = saved;
    sendMock.mockClear();
  });

  it('receipt escpos returns base64 that starts with ESC @', async () => {
    const { controller } = makeController();
    const res = await controller.receiptEscpos(user, 'b1', 'o1', undefined, undefined, {});
    const bytes = Buffer.from(res.data, 'base64');
    expect(bytes.subarray(0, 2).equals(ESC_INIT)).toBe(true);
    expect(res.contentType).toBe('application/vnd.escpos');
    expect(res.paperWidth).toBe(80);
    expect(res.codepage).toBe('CP858');
    expect(sendMock).not.toHaveBeenCalled(); // bytes only, nothing sent
  });

  it('drawer=true appends the drawer pulse, no flag does not', async () => {
    const { controller } = makeController();
    const withDrawer = await controller.receiptEscpos(user, 'b1', 'o1', undefined, 'true', {});
    const without = await controller.receiptEscpos(user, 'b1', 'o1', undefined, undefined, {});
    expect(Buffer.from(withDrawer.data, 'base64').indexOf(DRAWER_PULSE)).toBeGreaterThan(-1);
    expect(Buffer.from(without.data, 'base64').indexOf(DRAWER_PULSE)).toBe(-1);
  });

  it('kitchen ticket bytes for an order of another branch/restaurant answer 404', async () => {
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      kot: { findMany: jest.fn() },
    };
    const service = new KotPrintService(prisma as never, {} as never);
    await expect(service.escposForOrder('b1', 'foreign-order')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign-order', branchId: 'b1' } }),
    );
    expect(prisma.kot.findMany).not.toHaveBeenCalled();
  });

  it('direct print routes answer 409 when ALLOW_SERVER_PRINT is unset and send nothing', async () => {
    delete process.env.ALLOW_SERVER_PRINT;
    const { controller } = makeController();
    await expect(controller.openDrawer(user, 'b1')).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.printTest(user, 'b1')).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.printDiagnostics(user, 'b1')).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.printUsb(user, 'b1', 'o1')).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.printKot(user, 'b1', 'o1')).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.openDrawer(user, 'b1')).rejects.toMatchObject({
      response: { code: 'SERVER_PRINT_DISABLED', message: 'Printing is done by the UDYOG POS desktop app' },
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('direct print routes run when ALLOW_SERVER_PRINT is "true"', async () => {
    process.env.ALLOW_SERVER_PRINT = 'true';
    const { controller } = makeController();
    await expect(controller.openDrawer(user, 'b1')).resolves.toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][1] as Buffer;
    expect(sent.indexOf(DRAWER_PULSE)).toBeGreaterThan(-1);
  });
});
