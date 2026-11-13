import { db } from "@/db";
import { sql } from "drizzle-orm";
import { storageBackend } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    if (storageBackend() === "postgres") await db.execute(sql`select 1 from audio_objects limit 0`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
