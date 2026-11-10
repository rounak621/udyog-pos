import { z } from "zod";
import { loginSchema, pinLoginSchema, sessionUserSchema } from "./auth";

// Sign-in for the native apps (Android waiter app first). The web keeps its
// httpOnly cookie; apps send `Authorization: Bearer <accessToken>` and renew
// it with the refresh token. Routes live under /api/v1/auth/app/*.

const deviceNameSchema = z.string().trim().min(1).max(100).optional();

export const appLoginSchema = loginSchema.extend({
  deviceName: deviceNameSchema,
});
export type AppLoginDto = z.infer<typeof appLoginSchema>;

export const appPinLoginSchema = pinLoginSchema.extend({
  deviceName: deviceNameSchema,
});
export type AppPinLoginDto = z.infer<typeof appPinLoginSchema>;

export const appRefreshSchema = z.object({
  refreshToken: z.string().min(20).max(300),
});
export type AppRefreshDto = z.infer<typeof appRefreshSchema>;

/** Answer of app login, PIN login and refresh. */
export const appTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** When the access token expires (ISO 8601). */
  expiresAt: z.string(),
  /** When the refresh token expires unless used before (ISO 8601). */
  refreshExpiresAt: z.string(),
  user: sessionUserSchema,
});
export type AppTokenResponse = z.infer<typeof appTokenResponseSchema>;

/** GET /auth/app/pin-staff?branchId= : who can sign in with a PIN on that branch. */
export const pinStaffMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
});
export type PinStaffMember = z.infer<typeof pinStaffMemberSchema>;

/** GET /auth/app/sessions : the caller's own active app sessions. */
export const appSessionInfoSchema = z.object({
  id: z.string(),
  deviceName: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
});
export type AppSessionInfo = z.infer<typeof appSessionInfoSchema>;
