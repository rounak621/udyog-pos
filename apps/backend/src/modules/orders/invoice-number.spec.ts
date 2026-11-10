import { financialYearOf, formatInvoiceNo } from '@nodedr-restaurant/types';
import { allocateInvoiceNumber } from './invoice-number';
import { nextOrderNumber, orderNumberDatePart } from './order-number';

describe('India financial year and invoice number format', () => {
  it('splits the financial year at 1 April 00:00 IST', () => {
    // 31 Mar 2027 23:59 IST = 18:29 UTC; 1 Apr 2027 00:00 IST = 18:30 UTC.
    expect(financialYearOf(new Date('2027-03-31T18:29:00Z'))).toEqual({
      label: '2026-27',
      short: '2627',
      startYear: 2026,
    });
    expect(financialYearOf(new Date('2027-03-31T18:30:00Z'))).toEqual({
      label: '2027-28',
      short: '2728',
      startYear: 2027,
    });
  });

  it('uses the IST date, not the UTC date', () => {
    // Still 31 Mar in UTC, already 1 Apr (01:30) in India.
    expect(financialYearOf(new Date('2027-03-31T20:00:00Z')).label).toBe('2027-28');
    // 1 Apr 00:00 UTC is 05:30 IST on 1 Apr: new year in both.
    expect(financialYearOf(new Date('2026-04-01T00:00:00Z')).label).toBe('2026-27');
    // Mid-year and a century boundary.
    expect(financialYearOf(new Date('2026-11-10T10:00:00Z')).short).toBe('2627');
    expect(financialYearOf(new Date('2099-12-01T00:00:00Z')).label).toBe('2099-00');
  });

  it('formats PREFIX/FYSHORT/NNNNNN, max 16 chars, validates the prefix', () => {
    expect(formatInvoiceNo('INV', '2627', 1)).toBe('INV/2627/000001');
    expect(formatInvoiceNo('ab12', '2627', 123456)).toBe('AB12/2627/123456');
    expect(formatInvoiceNo('ab12', '2627', 123456)).toHaveLength(16);
    expect(() => formatInvoiceNo('ABCDE', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('IN-V', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('INV', '2627', 0)).toThrow();
    expect(() => formatInvoiceNo('INV', '2627', 1_000_000)).toThrow();
  });
});

describe('order numbers', () => {
  it('use the IST day at 00:30 IST and are taken under a per-branch/day lock', async () => {
    const at0030Ist = new Date('2026-11-09T19:00:00Z'); // 10 Nov 00:30 IST
    expect(orderNumberDatePart(at0030Ist)).toBe('20261110');

    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve(1);
      }),
      order: {
        findFirst: jest.fn().mockImplementation(() => {
          calls.push('max');
          return Promise.resolve({ orderNumber: '20261110-0041' });
        }),
      },
    };
    const n = await nextOrderNumber(tx as never, 'b1', at0030Ist);
    expect(n).toBe('20261110-0042');
    expect(calls).toEqual(['lock', 'max']); // lock first, then MAX+1
    expect(tx.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId: 'b1', orderNumber: { startsWith: '20261110-' } },
      }),
    );
  });
});

describe('allocateInvoiceNumber', () => {
  it('takes the next number of the (restaurant, prefix, FY) series, default prefix INV', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'series-1', lastNumber: 7 }]),
    };
    const now = new Date('2026-11-10T10:00:00Z');
    const res = await allocateInvoiceNumber(tx as never, {
      restaurantId: 'r1',
      branchId: 'b1',
      prefix: null,
      now,
    });
    expect(res).toEqual({
      invoiceNo: 'INV/2627/000007',
      invoiceSeriesId: 'series-1',
      invoiceIssuedAt: now,
      invoiceRestaurantId: 'r1',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
