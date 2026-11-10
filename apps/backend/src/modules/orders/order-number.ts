import type { Prisma } from '@prisma/client';
import { localDate } from '../../common/time';

// Order numbers: YYYYMMDD-NNNN, sequential per branch per day.
//
// - The day is the India (Asia/Kolkata) calendar day, so an order at 00:30
//   IST belongs to that day, not to the previous UTC day.
// - The number is taken INSIDE the transaction that creates the order, after
//   a Postgres advisory transaction lock on (branch, day). Two orders created
//   at the same moment therefore queue on the lock and get N and N+1 instead
//   of racing for the same number. The lock is released at commit/rollback.
// - It is the highest existing sequence of that day + 1 (not a row count), so
//   deleted orders never cause a duplicate. The unique (branchId, orderNumber)
//   index stays as the last line of defence.
// Every order path (staff POS, QR menu, kiosk, API keys, MCP) goes through
// OrdersService.createOrder, which is the only caller.

export const ORDER_NUMBER_TIME_ZONE = 'Asia/Kolkata';

/** YYYYMMDD of the IST calendar day of `now`. */
export function orderNumberDatePart(now: Date): string {
  return localDate(now, ORDER_NUMBER_TIME_ZONE).replace(/-/g, '');
}

export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  now: Date = new Date(),
): Promise<string> {
  const datePart = orderNumberDatePart(now);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-number|${branchId}|${datePart}`}))`;
  const latest = await tx.order.findFirst({
    where: { branchId, orderNumber: { startsWith: `${datePart}-` } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  const last = latest ? Number(latest.orderNumber.split('-')[1]) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${datePart}-${String(next).padStart(4, '0')}`;
}
