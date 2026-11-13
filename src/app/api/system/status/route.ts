import { withUser } from "@/lib/http";
import { recoverStaleJobs, systemStatus } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await withUser();
  if (a.res) return a.res;
  await recoverStaleJobs();
  return Response.json(await systemStatus());
}
