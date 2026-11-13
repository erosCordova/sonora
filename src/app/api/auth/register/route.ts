import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { clientIp, jsonError, parseBody } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";
import { registerSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = rateLimit(`register:${clientIp(req)}`, 8, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, registerSchema);
  if (!body.ok) return body.res;
  const { name, email, password } = body.data;
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (exists) return jsonError("Ya existe una cuenta con ese correo", 409);
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });
  await createSession(user.id);
  return Response.json({ ok: true });
}
