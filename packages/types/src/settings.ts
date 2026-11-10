import { z } from "zod";

// The restaurant's brand name renders in the app shell's top-of-sidebar
// header (fixed-width column, next to the logo) — a name much past this
// starts wrapping/truncating there, so the settings form enforces the same
// limit the layout was built around rather than letting it overflow.
export const RESTAURANT_NAME_MAX_LENGTH = 40;

export const restaurantSettingsSchema = z.object({
  name: z.string().min(1).max(RESTAURANT_NAME_MAX_LENGTH).optional(),
  legalName: z.string().optional(),
  // Shown in place of the product logo in the app shell header and on the
  // login screen once set. Square, ~256x256px+ PNG/SVG with a transparent
  // background reads best in that slot — see the settings page hint text.
  logoUrl: z.string().max(2048).optional().nullable(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  // UPI id such as "name@okbank" (VPA format per NPCI: handle@psp).
  upiVpa: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/, "Enter a valid UPI id like name@bank")
    .optional()
    .nullable(),
  upiPayeeName: z.string().trim().max(60).optional().nullable(),
  loyaltyPointValue: z.coerce.number().min(0).optional(),
  loyaltyEarnPerCurrency: z.coerce.number().int().positive().optional(),
});
export type RestaurantSettingsDto = z.infer<typeof restaurantSettingsSchema>;

import { fssaiSchema, hsnSacSchema, TAX_MODES, TAX_REGIMES } from "./tax";

export const branchSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  gstNumber: z.string().optional(),
  // Multi-region tax config — see tax.ts for the regime presets this
  // pairs with (label, default mode, CGST/SGST split).
  country: z.string().length(2).optional(),
  taxRegime: z.enum(TAX_REGIMES).optional(),
  taxMode: z.enum(TAX_MODES).optional(),
  taxLabel: z.string().max(30).optional().nullable(),
  taxId: z.string().max(50).optional().nullable(),
  // India GST: fallback HSN/SAC for items without their own code.
  defaultHsnSac: hsnSacSchema,
  // India: FSSAI licence number printed on bills (14 digits, empty allowed).
  fssaiNumber: fssaiSchema,
  // India: prefix of the sales invoice series (1-4 letters/digits, empty =
  // default "INV"). A new prefix starts a new series from 000001.
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z0-9]{1,4}$/.test(v), "Use 1 to 4 letters or numbers")
    .nullable()
    .optional(),
  // Online order / table-booking handling (false = staff accept manually).
  autoConfirmOrders: z.boolean().optional(),
  autoConfirmReservations: z.boolean().optional(),
  // Self-service kiosk: which service-mode buttons the start screen offers.
  kioskDineInEnabled: z.boolean().optional(),
  kioskTakeawayEnabled: z.boolean().optional(),
  // Thermal printer (direct ESC/POS): paper, code page and column override.
  printerPaperWidthMm: z.union([z.literal(58), z.literal(80)]).optional(),
  printerCodepage: z.enum(["CP437", "CP850", "CP858", "CP1252"]).optional(),
  printerColumns: z.number().int().min(20).max(64).nullable().optional(),
  // How the server reaches the thermal printer: USB attached to the server,
  // or a network printer (raw ESC/POS over TCP, normally port 9100).
  printerConnection: z.enum(["USB", "NETWORK"]).optional(),
  printerHost: z
    .string()
    .trim()
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/, "Use an IP address or host name")
    .nullable()
    .optional(),
  printerPort: z.number().int().min(1).max(65535).optional(),
});
export type BranchSettingsDto = z.infer<typeof branchSettingsSchema>;
