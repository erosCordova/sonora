import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, videos } from "@/db/schema";
import { jsonError, withUser } from "@/lib/http";
import { removeObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Eliminar solo proyectos propios y finalizados; nunca interrumpir un worker mediante DELETE. */
export async function DELETE(_req: Request, ctx: { params: Promise<{id:string}> }) {
  const auth = await withUser();
  if (auth.res) return auth.res;
  const {id} = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Video no encontrado", 404);
  const [record] = await db.select({video:videos,job:jobs}).from(videos)
    .innerJoin(jobs,eq(videos.jobId,jobs.id))
    .where(and(eq(videos.id,id),eq(videos.userId,auth.user.id))).limit(1);
  if (!record) return jsonError("Video no encontrado",404);
  if (["pending","running"].includes(record.job.status))
    return jsonError("Cancela el video antes de eliminarlo.",409);
  const [deleted] = await db.delete(jobs)
    .where(and(eq(jobs.id,record.job.id),eq(jobs.userId,auth.user.id),
      inArray(jobs.status,["completed","failed","cancelled"])))
    .returning({id:jobs.id});
  if (!deleted) return jsonError("La tarea cambió de estado, actualiza la biblioteca.",409);
  await Promise.all([record.video.sourceKey,record.video.outputKey].filter((key):key is string=>Boolean(key))
    .map(key=>removeObject(key).catch(error=>console.warn("[video] limpieza de archivo",error))));
  return Response.json({ok:true});
}
