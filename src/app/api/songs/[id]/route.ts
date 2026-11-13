import { asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { jobs, songs } from "@/db/schema";
import { jsonError, parseBody, withUser } from "@/lib/http";
import { getAccessibleSong, getOwnedSong, serializeSong } from "@/lib/songs";
import { removeObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const a = await withUser();
  if (a.res) return a.res;
  const { id } = await ctx.params;
  const row = await getAccessibleSong(id, a.user.id);
  if (!row) return jsonError("Canción no encontrada", 404);
  let versions: ReturnType<typeof serializeSong>[] = [];
  if (row.song.userId === a.user.id) {
    const rootId = row.song.rootId ?? row.song.id;
    const list = await db
      .select()
      .from(songs)
      .where(or(eq(songs.rootId, rootId), eq(songs.id, rootId)))
      .orderBy(asc(songs.createdAt));
    versions = list.filter((s) => s.userId === a.user.id).map((s) => serializeSong(s, a.user.id));
  }
  return Response.json({ song: serializeSong(row.song, a.user.id, row.ownerName), versions });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  isFavorite: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await withUser();
  if (a.res) return a.res;
  const { id } = await ctx.params;
  const song = await getOwnedSong(id, a.user.id);
  if (!song) return jsonError("Canción no encontrada", 404);
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.res;
  if (Object.keys(body.data).length === 0) return jsonError("Nada que actualizar", 422);
  const [updated] = await db.update(songs).set(body.data).where(eq(songs.id, id)).returning();
  return Response.json({ song: serializeSong(updated, a.user.id) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const a = await withUser();
  if (a.res) return a.res;
  const { id } = await ctx.params;
  const song = await getOwnedSong(id, a.user.id);
  if (!song) return jsonError("Canción no encontrada", 404);
  await db.update(jobs).set({ songId: null }).where(eq(jobs.songId, id));
  await db.delete(songs).where(eq(songs.id, id));
  await removeObject(song.audioKey).catch((e) => console.error("[storage] fallo al borrar", song.audioKey, e));
  return Response.json({ ok: true });
}
