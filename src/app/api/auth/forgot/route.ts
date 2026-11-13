import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { sha256 } from "@/lib/auth";
import { clientIp, parseBody } from "@/lib/http";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { limited, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

function origin(req: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const rl = rateLimit(`forgot:${clientIp(req)}`, 5, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  if (!body.ok) return body.res;
  const [user] = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
  if (user) {
    const token = randomBytes(32).toString("hex");
    await db.insert(passwordResets).values({
      id: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const link = `${origin(req)}/reset?token=${token}`;
    try {
      const sent = await sendMail(
        user.email,
        "Restablece tu contraseña de Sonora",
        `Hola ${user.name},\n\nUsa este enlace (válido 1 hora) para elegir una nueva contraseña:\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
      );
      if (!sent) console.warn(`[auth] SMTP no configurado. Enlace de recuperación para ${user.email}: ${link}`);
    } catch (e) {
      console.error("[auth] Error enviando correo de recuperación:", e);
    }
  }
  // Respuesta idéntica exista o no la cuenta
  return Response.json({ ok: true, mailConfigured: mailConfigured() });
}
