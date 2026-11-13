import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getCurrentUser, type SafeUser } from "@/lib/auth";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: jsonError("Cuerpo JSON inválido", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "campo"}: ${i.message}`).join("; ");
    return { ok: false, res: jsonError(`Datos inválidos — ${msg}`, 422) };
  }
  return { ok: true, data: parsed.data };
}

export async function withUser(): Promise<
  { user: SafeUser; res?: undefined } | { user?: undefined; res: Response }
> {
  const user = await getCurrentUser();
  if (!user) return { res: jsonError("No autenticado", 401) };
  return { user };
}

export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

/** Autenticación de workers por token Bearer. */
export function checkWorker(req: Request): Response | null {
  const token = process.env.WORKER_TOKEN;
  if (!token) return jsonError("WORKER_TOKEN no está configurado en el servidor", 503);
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return jsonError("Token de worker inválido", 401);
  return null;
}
