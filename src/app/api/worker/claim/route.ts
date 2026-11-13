import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { checkWorker, parseBody } from "@/lib/http";
import { claimJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkWorker(req);
  if (denied) return denied;
  const body = await parseBody(req, z.object({ workerId: z.string().min(1).max(80), engine: z.string().min(1).max(40) }));
  if (!body.ok) return body.res;
  const job = await claimJob(body.data.workerId, body.data.engine);
  if (!job) return Response.json({ job: null });
  const [parent] = job.parentSongId
    ? await db.select().from(songs).where(eq(songs.id, job.parentSongId))
    : [];
  return Response.json({
    job: {
      id: job.id,
      kind: job.kind,
      title: job.title,
      params: job.params,
      attempts: job.attempts,
      parent: parent
        ? { id: parent.id, title: parent.title, durationSec: parent.durationSec, mime: parent.audioMime }
        : null,
      sourcePath: parent ? `/api/worker/jobs/${job.id}/source` : null,
    },
  });
}
