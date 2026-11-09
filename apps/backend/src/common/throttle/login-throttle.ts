import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

// Login-style routes get a second, named throttler keyed by IP + account
// (lowercased email, or userId for PIN login), on top of the app-wide
// per-IP limit. On one cloud server for many restaurants, a per-IP-only key
// would let one person behind a shared IP (or a proxy without TRUST_PROXY)
// lock everyone else out. Storage is the default in-memory one; a shared
// store (Redis) is a later step for running more than one backend.
const LOGIN_THROTTLE = 'loginThrottleKey';
type LoginKey = 'email' | 'userId';

/** Marks a route for the per-account "login" throttler. */
export const LoginThrottle = (key: LoginKey) =>
  SetMetadata(LOGIN_THROTTLE, key);

function keyFor(context: ExecutionContext): LoginKey | undefined {
  return Reflect.getMetadata(LOGIN_THROTTLE, context.getHandler()) as
    LoginKey | undefined;
}

/** Tracker: client IP + lowercased email (or userId). */
export function loginTracker(
  req: Record<string, any>,
  context: ExecutionContext,
): string {
  const field = keyFor(context) ?? 'email';
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body[field];
  const account = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return `${String(req.ip)}|${field}:${account}`;
}

/** 5 attempts per minute per IP + account, only on @LoginThrottle routes. */
export const loginThrottler: ThrottlerOptions = {
  name: 'login',
  ttl: 60_000,
  limit: 5,
  getTracker: loginTracker,
  skipIf: (context) => keyFor(context) === undefined,
};
