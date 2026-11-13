import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, songs } from "@/db/schema";
import { checkWorker, jsonError } from "@/lib/http";
import { statObject, streamObject } from "@/lib/storage";
import { readWorkerLease } from "@/lib/worker-lease";

export const dynamic = "force-dynamic";

// El worker descarga el audio fuente (cover / repaint / extend) de su tarea.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkWorker(req);
  if (denied) return denied;
  const lease = readWorkerLease(req);
  if (!lease) return jsonError("Falta la identificación del intento del worker", 400);
  const { id } = await ctx.params;
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.workerId, lease.workerId), eq(jobs.attempts, lease.attempt)));
  if (!job) return jsonError("La tarea ya no pertenece a este intento", 409);
  if (!job?.parentSongId) return jsonError("La tarea no tiene audio fuente", 404);
  const [song] = await db.select().from(songs).where(eq(songs.id, job.parentSongId));
  if (!song) return jsonError("Audio fuente eliminado", 410);
  const st = await statObject(song.audioKey);
  if (!st) return jsonError("Archivo fuente no encontrado", 410);
  return new Response(Readable.toWeb(await streamObject(song.audioKey)) as ReadableStream, {
    headers: { "Content-Type": song.audioMime, "Content-Length": String(st.size) },
  });
}
