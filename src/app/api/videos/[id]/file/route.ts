import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { jsonError, withUser } from "@/lib/http";
import { statObject, streamObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: {params:Promise<{id:string}>}) {
  const auth = await withUser();
  if (auth.res) return auth.res;
  const {id} = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Video no encontrado",404);
  const [video] = await db.select().from(videos)
    .where(and(eq(videos.id,id),eq(videos.userId,auth.user.id))).limit(1);
  if (!video?.outputKey) return jsonError("El video todavía no está disponible",404);
  const stat = await statObject(video.outputKey);
  if (!stat) return jsonError("Archivo de video no encontrado",410);
  const size = stat.size;
  const h = new Headers({"Content-Type":"video/mp4","Accept-Ranges":"bytes",
    "Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff"});
  if (new URL(req.url).searchParams.get("download") === "1") {
    h.set("Content-Disposition",`attachment; filename="sonora-video-${id}.mp4"`);
  }
  const match = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    let from = match[1] ? Number(match[1]) : size - Number(match[2]);
    let to = match[1] && match[2] ? Number(match[2]) : size - 1;
    from = Math.max(0,from); to = Math.min(size-1,to);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= size || from > to) {
      return new Response(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
    }
    h.set("Content-Range",`bytes ${from}-${to}/${size}`);
    h.set("Content-Length",String(to-from+1));
    return new Response(Readable.toWeb(await streamObject(video.outputKey,from,to)) as ReadableStream,{status:206,headers:h});
  }
  h.set("Content-Length",String(size));
  return new Response(Readable.toWeb(await streamObject(video.outputKey)) as ReadableStream,{headers:h});
}
