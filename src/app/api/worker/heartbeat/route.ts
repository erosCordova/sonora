import { z } from "zod";
import { db } from "@/db";
import { jobs, workers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { checkWorker, parseBody } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  workerId: z.string().min(1).max(80),
  name: z.string().max(120).default("worker"),
  engine: z.string().max(40),
  info: z.record(z.string(), z.unknown()).default({}),
  currentJobId: z.string().uuid().nullable().default(null),
  currentJobAttempt: z.number().int().positive().nullable().default(null),
}).refine((d) => (d.currentJobId === null) === (d.currentJobAttempt === null), {
  message: "La tarea y su intento deben enviarse juntos",
});

export async function POST(req: Request) {
  const denied = checkWorker(req);
  if (denied) return denied;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const d = body.data;
  await db
    .insert(workers)
    .values({ id: d.workerId, name: d.name, engine: d.engine, info: d.info, currentJobId: d.currentJobId, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: workers.id,
      set: { name: d.name, engine: d.engine, info: d.info, currentJobId: d.currentJobId, lastSeenAt: new Date() },
    });
  let cancel = false;
  if (d.currentJobId && d.currentJobAttempt) {
    const updated = await db
      .update(jobs)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(jobs.id, d.currentJobId), eq(jobs.status, "running"), eq(jobs.workerId, d.workerId), eq(jobs.attempts, d.currentJobAttempt)))
      .returning({ id: jobs.id });
    cancel = updated.length === 0;
  }
  return Response.json({ ok: true, cancel });
}
