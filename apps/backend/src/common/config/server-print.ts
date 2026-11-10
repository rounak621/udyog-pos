import { ConflictException } from '@nestjs/common';

// Printing from the server itself (USB on the server host, or TCP 9100 from
// the server) only makes sense when the server runs inside the restaurant.
// In the cloud it cannot reach a restaurant's printer, so it is OFF unless
// ALLOW_SERVER_PRINT=true. The UDYOG POS desktop app prints instead, using
// the byte-only /escpos routes. Read per call (a cheap env lookup) so the
// setting and its tests stay in this one place.

export const SERVER_PRINT_DISABLED_MESSAGE =
  'Printing is done by the UDYOG POS desktop app';

export function isServerPrintEnabled(): boolean {
  return process.env.ALLOW_SERVER_PRINT === 'true';
}

/** Throws 409 SERVER_PRINT_DISABLED before anything is sent to hardware. */
export function assertServerPrintEnabled(): void {
  if (!isServerPrintEnabled()) {
    throw new ConflictException({
      code: 'SERVER_PRINT_DISABLED',
      message: SERVER_PRINT_DISABLED_MESSAGE,
    });
  }
}
