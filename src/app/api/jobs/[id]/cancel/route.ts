import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { jsonError, withUser } from "@/lib/http";
import { serializeJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await withUser();
  if (a.res) return a.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Tarea no encontrada", 404);
  const [row] = await db
    .update(jobs)
    .set({ status: "cancelled", stage: "Cancelada", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, a.user.id), inArray(jobs.status, ["pending", "running"])))
    .returning();
  if (!row) return jsonError("La tarea no existe o ya terminó", 404);
  return Response.json({ job: serializeJob(row) });
}
