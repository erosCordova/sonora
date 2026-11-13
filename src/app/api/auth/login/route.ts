import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { clientIp, jsonError, parseBody } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";
import { loginSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

let dummyHash: Promise<string> | null = null;

export async function POST(req: Request) {
  const body = await parseBody(req, loginSchema);
  if (!body.ok) return body.res;
  const { email, password } = body.data;
  const rl = rateLimit(`login:${clientIp(req)}:${email}`, 10, 15 * 60_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Misma carga de trabajo exista o no el usuario (evita enumeración por tiempos)
  dummyHash ??= hashPassword("dummy-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) return jsonError("Correo o contraseña incorrectos", 401);
  await createSession(user.id);
  return Response.json({ ok: true });
}
