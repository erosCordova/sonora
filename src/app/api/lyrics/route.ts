import { jsonError, parseBody, withUser } from "@/lib/http";
import { generateLyrics, LlmError, regenerateSection } from "@/lib/llm";
import { limited, rateLimit } from "@/lib/ratelimit";
import { lyricsSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function POST(req: Request) {
  const a = await withUser();
  if (a.res) return a.res;
  const rl = rateLimit(`lyrics:${a.user.id}`, 30, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const body = await parseBody(req, lyricsSchema);
  if (!body.ok) return body.res;
  const d = body.data;
  try {
    if (d.action === "section") {
      if (!d.lyrics || d.sectionIndex === undefined) return jsonError("Faltan la letra y la sección", 422);
      const lyrics = await regenerateSection({
        lyrics: d.lyrics,
        sectionIndex: d.sectionIndex,
        theme: d.theme,
        language: d.language,
      });
      return Response.json({ lyrics });
    }
    const lyrics = await generateLyrics(d);
    return Response.json({ lyrics });
  } catch (e) {
    if (e instanceof LlmError) return jsonError(e.message, e.status);
    console.error("[lyrics]", e);
    return jsonError("Error generando la letra", 500);
  }
}
