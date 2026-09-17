import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { GetCurrentUserResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/me", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkUserId = auth.userId;

  if (!clerkUserId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({ clerkUserId })
    .onConflictDoUpdate({
      target: usersTable.clerkUserId,
      set: { lastSeenAt: new Date() },
    })
    .returning();

  res.json(GetCurrentUserResponse.parse(user));
});

export default router;