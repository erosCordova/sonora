import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { fileSlug, getAccessibleSong } from "@/lib/songs";
import { statObject, streamObject, verifyAudioToken } from "@/lib/storage";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  let song;
  if (token && /^[0-9a-f-]{36}$/i.test(id) && verifyAudioToken(id, token)) {
    [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  } else {
    const user = await getCurrentUser();
    if (!user) return jsonError("No autenticado", 401);
    song = (await getAccessibleSong(id, user.id))?.song;
  }
  if (!song) return jsonError("Canción no encontrada", 404);
  const st = await statObject(song.audioKey);
  if (!st) return jsonError("El archivo de audio no existe en el almacenamiento", 410);

  const size = st.size;
  const headers = new Headers({
    "Content-Type": song.audioMime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (url.searchParams.get("download") === "1") {
    const ext = song.audioKey.split(".").pop();
    headers.set("Content-Disposition", `attachment; filename="${fileSlug(song.title)}.${ext}"`);
  }
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(await streamObject(song.audioKey, start, end)) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(await streamObject(song.audioKey)) as ReadableStream, { status: 200, headers });
}
