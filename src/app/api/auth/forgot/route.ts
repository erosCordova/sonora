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

function resetOrigin() {
  // No construir enlaces sensibles con Host ni X-Forwarded-Host, pues pueden
  // estar controlados por un atacante y redirigir el token a otro dominio.
  const configured = process.env.APP_URL?.trim();
  if (!configured && process.env.NODE_ENV === "production") return null;
  try {
    const url = new URL(configured || "http://localhost:3000");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(`forgot:${clientIp(req)}`, 5, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  if (!body.ok) return body.res;
  const [user] = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
  if (user) {
    const publicOrigin = resetOrigin();
    if (!publicOrigin) {
      console.error("[auth] Configura APP_URL con una URL pública HTTPS para la recuperación de contraseña.");
      return Response.json({ ok: true, mailConfigured: false });
    }
    const token = randomBytes(32).toString("hex");
    await db.insert(passwordResets).values({
      id: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const link = `${publicOrigin}/reset?token=${token}`;
    try {
      const sent = await sendMail(
        user.email,
        "Restablece tu contraseña de Sonora",
        `Hola ${user.name},\n\nUsa este enlace (válido 1 hora) para elegir una nueva contraseña:\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
      );
      if (!sent) {
        if (process.env.NODE_ENV === "production") {
          console.warn("[auth] SMTP no configurado. No se envió el enlace de recuperación.");
        } else {
          // En desarrollo local, permite probar el flujo sin un servidor SMTP.
          console.warn(`[auth] Desarrollo sin SMTP: ${link}`);
        }
      }
    } catch (e) {
      console.error("[auth] Error enviando correo de recuperación:", e);
    }
  }
  // Respuesta idéntica exista o no la cuenta
  return Response.json({ ok: true, mailConfigured: mailConfigured() });
}
