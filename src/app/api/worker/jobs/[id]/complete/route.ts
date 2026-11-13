import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { checkWorker, jsonError } from "@/lib/http";
import { finalizeJob, JobError } from "@/lib/jobs";
import { readWorkerLease } from "@/lib/worker-lease";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const MAX_BYTES = 150 * 1024 * 1024;

const metaSchema = z.object({
  durationSec: z.number().positive().max(1800),
  model: z.string().min(1).max(120),
  modelVersion: z.string().max(120).optional(),
  caption: z.string().max(2000).optional(),
  lyrics: z.string().max(8000).optional(),
  bpm: z.number().nullable().optional(),
  keyscale: z.string().max(40).optional(),
  language: z.string().max(8).optional(),
  title: z.string().max(200).optional(),
  seed: z.number().nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkWorker(req);
  if (denied) return denied;
  const lease = readWorkerLease(req);
  if (!lease) return jsonError("Falta la identificación del intento del worker", 400);
  const { id } = await ctx.params;
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.workerId, lease.workerId), eq(jobs.attempts, lease.attempt)));
  if (!job) return jsonError("La tarea ya no pertenece a este intento; resultado descartado", 409);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 65536) return jsonError("Archivo demasiado grande", 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("multipart/form-data inválido", 400);
  }
  const file = form.get("file");
  const metaRaw = form.get("meta");
  if (!(file instanceof File) || typeof metaRaw !== "string") return jsonError("Faltan 'file' y 'meta'", 422);
  if (file.size > MAX_BYTES) return jsonError("Archivo demasiado grande", 413);
  let meta;
  try {
    meta = metaSchema.parse(JSON.parse(metaRaw));
  } catch (e) {
    return jsonError(`Metadatos inválidos: ${(e as Error).message}`, 422);
  }
  try {
    const song = await finalizeJob(job, Buffer.from(await file.arrayBuffer()), meta, lease);
    return Response.json({ ok: true, songId: song.id });
  } catch (e) {
    if (e instanceof JobError) return jsonError(e.message, e.status);
    console.error("[worker] complete failed", e);
    return jsonError("Error guardando el resultado", 500);
  }
}
