import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, revokeAllSessions, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { jsonError, parseBody, withUser } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await withUser();
  if (a.res) return a.res;
  const rl = rateLimit(`pwd:${a.user.id}`, 6, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, z.object({ current: z.string().min(1), next: z.string().min(8).max(200) }));
  if (!body.ok) return body.res;
  const [u] = await db.select().from(users).where(eq(users.id, a.user.id));
  if (!u || !(await verifyPassword(body.data.current, u.passwordHash))) return jsonError("La contraseña actual es incorrecta", 403);
  await db.update(users).set({ passwordHash: await hashPassword(body.data.next) }).where(eq(users.id, u.id));
  const jar = await cookies();
  await revokeAllSessions(u.id, jar.get(SESSION_COOKIE)?.value);
  return Response.json({ ok: true });
}
