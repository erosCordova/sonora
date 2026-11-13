import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { checkWorker, jsonError, parseBody } from "@/lib/http";
import { readWorkerLease } from "@/lib/worker-lease";

export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z.string().max(120),
  progress: z.number().min(0).max(1).nullable().default(null),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkWorker(req);
  if (denied) return denied;
  const lease = readWorkerLease(req);
  if (!lease) return jsonError("Falta la identificación del intento del worker", 400);
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const [row] = await db
    .update(jobs)
    .set({ stage: body.data.stage, progress: body.data.progress, heartbeatAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.workerId, lease.workerId), eq(jobs.attempts, lease.attempt)))
    .returning({ id: jobs.id });
  if (!row) return jsonError("La tarea ya no está en ejecución (cancelada o reasignada)", 409, { cancelled: true });
  return Response.json({ ok: true });
}
