import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { checkWorker, jsonError, parseBody } from "@/lib/http";
import { readWorkerLease } from "@/lib/worker-lease";

export const dynamic = "force-dynamic";

const schema = z.object({ error: z.string().max(4000), retryable: z.boolean().default(false) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkWorker(req);
  if (denied) return denied;
  const lease = readWorkerLease(req);
  if (!lease) return jsonError("Falta la identificación del intento del worker", 400);
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const match = and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.workerId, lease.workerId), eq(jobs.attempts, lease.attempt));
  const [job] = await db.select().from(jobs).where(match);
  if (!job) return jsonError("La tarea ya no pertenece a este intento", 409);
  const retry = body.data.retryable && job.attempts < job.maxAttempts;
  const updated = await db
    .update(jobs)
    .set(
      retry
        ? { status: "pending", stage: "Reintentando tras un error", progress: null, workerId: null, error: body.data.error }
        : { status: "failed", stage: "Fallida", error: body.data.error, finishedAt: new Date() },
    )
    .where(match)
    .returning({ id: jobs.id });
  if (!updated.length) return jsonError("La tarea ya no pertenece a este intento", 409);
  return Response.json({ ok: true, retry });
}
