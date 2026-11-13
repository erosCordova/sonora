import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { hashPassword, sha256 } from "@/lib/auth";
import { clientIp, jsonError, parseBody } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = rateLimit(`reset:${clientIp(req)}`, 10, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(200) }));
  if (!body.ok) return body.res;
  const passwordHash = await hashPassword(body.data.password);
  const updated = await db.transaction(async (tx) => {
    const now = new Date();
    // El UPDATE condicional consume el token de manera atómica: dos peticiones
    // simultáneas no pueden restablecer la contraseña con el mismo enlace.
    const [claimed] = await tx.update(passwordResets)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResets.id, sha256(body.data.token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, now),
      ))
      .returning({ userId: passwordResets.userId });
    if (!claimed) return false;
    await tx.update(users).set({ passwordHash }).where(eq(users.id, claimed.userId));
    await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, claimed.userId), isNull(passwordResets.usedAt)));
    await tx.delete(sessions).where(eq(sessions.userId, claimed.userId));
    return true;
  });
  if (!updated) return jsonError("El enlace es inválido o ha caducado", 400);
  return Response.json({ ok: true });
}
