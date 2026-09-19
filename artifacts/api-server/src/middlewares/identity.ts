import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

export const GUEST_COOKIE = "fw_guest";
const GUEST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;

export interface Identity {
  /** `users.id`, only when a real Clerk session is present. */
  userId: number | null;
  clerkUserId: string | null;
  /** always present, an opaque, unguessable per-browser id. */
  guestId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity: Identity;
    }
  }
}

/**
 * Two-headed identity, on purpose.
 *
 * Clerk is wired up and authoritative when a session exists, but the demo path
 * must not have auth on it: a stranger opens the link, builds a bot and fights
 * it without an account. So every request also carries a guest id from an
 * httpOnly cookie, and ownership checks accept either. The cookie value is 160
 * bits of randomness, guessing someone else's is the attack, and it isn't one.
 *
 * Signing in later is an UPDATE stamping `owner_user_id` onto the guest's rows;
 * nothing else in the system needs to know which kind of owner it is dealing with.
 */
export function identityMiddleware(): RequestHandler {
  return async (req, res, next) => {
    try {
      let guestId = req.cookies?.[GUEST_COOKIE] as string | undefined;
      if (!guestId || typeof guestId !== "string" || guestId.length < 16) {
        guestId = `g_${randomBytes(20).toString("base64url")}`;
        res.cookie(GUEST_COOKIE, guestId, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: GUEST_MAX_AGE_MS,
          path: "/",
        });
      }

      let clerkUserId: string | null = null;
      try {
        clerkUserId = getAuth(req).userId ?? null;
      } catch (err) {
        // Placeholder Clerk keys locally: treat as signed out rather than 500.
        logger.debug({ err }, "clerk auth unavailable, continuing as guest");
      }

      let userId: number | null = null;
      if (clerkUserId) {
        const [user] = await db
          .insert(usersTable)
          .values({ clerkUserId })
          .onConflictDoUpdate({
            target: usersTable.clerkUserId,
            set: { lastSeenAt: new Date() },
          })
          .returning();
        userId = user?.id ?? null;
      }

      req.identity = { userId, clerkUserId, guestId };
      next();
    } catch (err) {
      next(err);
    }
  };
}
