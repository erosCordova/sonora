import { jsonError, parseBody, withUser } from "@/lib/http";
import { createGenerateJobs, JobError, serializeJob, userJobs } from "@/lib/jobs";
import { LlmError } from "@/lib/llm";
import { limited, rateLimit } from "@/lib/ratelimit";
import { generateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await withUser();
  if (a.res) return a.res;
  return Response.json({ jobs: await userJobs(a.user.id) });
}

export async function POST(req: Request) {
  const a = await withUser();
  if (a.res) return a.res;
  const rl = rateLimit(`jobs:${a.user.id}`, 20, 600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, generateSchema);
  if (!body.ok) return body.res;
  try {
    const rows = await createGenerateJobs(a.user.id, body.data);
    return Response.json({ jobs: rows.map(serializeJob) }, { status: 201 });
  } catch (e) {
    if (e instanceof JobError || e instanceof LlmError) return jsonError(e.message, e.status);
    console.error("[jobs] create failed", e);
    return jsonError("No se pudo crear la tarea", 500);
  }
}
