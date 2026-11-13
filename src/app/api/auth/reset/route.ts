import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { hashPassword, revokeAllSessions, sha256 } from "@/lib/auth";
import { clientIp, jsonError, parseBody } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = rateLimit(`reset:${clientIp(req)}`, 10, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(200) }));
  if (!body.ok) return body.res;
  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.id, sha256(body.data.token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!reset) return jsonError("El enlace es inválido o ha caducado", 400);
  await db.update(users).set({ passwordHash: await hashPassword(body.data.password) }).where(eq(users.id, reset.userId));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
  await revokeAllSessions(reset.userId);
  return Response.json({ ok: true });
}
