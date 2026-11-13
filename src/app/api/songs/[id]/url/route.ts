import { jsonError, withUser } from "@/lib/http";
import { getAccessibleSong } from "@/lib/songs";
import { signAudioToken } from "@/lib/storage";

export const dynamic = "force-dynamic";

// URL temporal firmada (1 h) para reproducir/descargar sin exponer el archivo de forma permanente.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await withUser();
  if (a.res) return a.res;
  const { id } = await ctx.params;
  const row = await getAccessibleSong(id, a.user.id);
  if (!row) return jsonError("Canción no encontrada", 404);
  const t = signAudioToken(id, 3600);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return Response.json({
    url: `/api/songs/${id}/audio?t=${t}${download ? "&download=1" : ""}`,
    expiresIn: 3600,
  });
}
