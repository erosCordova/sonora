import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, videos } from "@/db/schema";
import { checkWorker,jsonError } from "@/lib/http";
import { readWorkerLease } from "@/lib/worker-lease";
import { statObject,streamObject } from "@/lib/storage";
import { VIDEO_ENGINE } from "@/lib/video";

export const dynamic = "force-dynamic";
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}) {
  const denied=checkWorker(req); if (denied) return denied;
  const lease=readWorkerLease(req);if(!lease) return jsonError("Falta identificación del intento",400);
  const {id}=await ctx.params;
  const [job]=await db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.id,id),
    eq(jobs.kind,"video"),eq(jobs.engine,VIDEO_ENGINE),eq(jobs.status,"running"),
    eq(jobs.workerId,lease.workerId),eq(jobs.attempts,lease.attempt))).limit(1);
  if(!job) return jsonError("Intento no autorizado",409);
  const [v]=await db.select().from(videos).where(eq(videos.jobId,id)).limit(1);
  if(!v) return jsonError("Proyecto no encontrado",404);
  const stat=await statObject(v.sourceKey);if(!stat) return jsonError("Archivos del proyecto no encontrados",410);
  return new Response(Readable.toWeb(await streamObject(v.sourceKey)) as ReadableStream,{
    headers:{"Content-Type":"application/octet-stream","Content-Length":String(stat.size),"Cache-Control":"no-store"},
  });
}
