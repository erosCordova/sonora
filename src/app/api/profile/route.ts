import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { songs, users } from "@/db/schema";
import { destroySession, verifyPassword } from "@/lib/auth";
import { jsonError, parseBody, withUser } from "@/lib/http";
import { removeObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await withUser();
  if (a.res) return a.res;
  return Response.json({ user: a.user });
}

export async function PATCH(req: Request) {
  const a = await withUser();
  if (a.res) return a.res;
  const body = await parseBody(req, z.object({ name: z.string().trim().min(2).max(80), bio: z.string().trim().max(300).default("") }));
  if (!body.ok) return body.res;
  await db.update(users).set(body.data).where(eq(users.id, a.user.id));
  return Response.json({ ok: true });
}

// Eliminación de cuenta: borra usuario, canciones y archivos de audio.
export async function DELETE(req: Request) {
  const a = await withUser();
  if (a.res) return a.res;
  const body = await parseBody(req, z.object({ password: z.string().min(1) }));
  if (!body.ok) return body.res;
  const [u] = await db.select().from(users).where(eq(users.id, a.user.id));
  if (!u || !(await verifyPassword(body.data.password, u.passwordHash))) return jsonError("Contraseña incorrecta", 403);
  const files = await db.select({ key: songs.audioKey }).from(songs).where(eq(songs.userId, u.id));
  for (const f of files) await removeObject(f.key).catch(() => {});
  await db.delete(users).where(inArray(users.id, [u.id]));
  await destroySession();
  return Response.json({ ok: true });
}
