import { jsonError, withUser } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";
import { createVideo, listVideos, videoMotorStatus, VideoError, type NewVideo } from "@/lib/video";
import { StorageQuotaError } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const LIMIT = 25 * 1024 * 1024;

export async function GET() {
  const auth = await withUser();
  if (auth.res) return auth.res;
  const [videos, motor] = await Promise.all([listVideos(auth.user.id), videoMotorStatus()]);
  return Response.json({ videos, motor }, { headers: {"Cache-Control":"no-store"} });
}

export async function POST(req: Request) {
  const auth = await withUser();
  if (auth.res) return auth.res;
  const rl = rateLimit(`videos:${auth.user.id}`, 5, 60 * 60_000);
  if (!rl.ok) return limited(rl.retryAfter);
  if (Number(req.headers.get("content-length") || 0) > LIMIT) return jsonError("Máximo 24 MB por proyecto", 413);
  let form: FormData;
  try { form = await req.formData(); }
  catch { return jsonError("No se pudo leer los archivos del proyecto", 400); }
  const get = (key: string) => String(form.get(key) ?? "").trim();
  const input: NewVideo = {
    title: get("title").slice(0, 120),
    mode: get("mode") === "manga" ? "manga" : get("mode") === "letra" ? "letra" : "imagenes",
    aspect: get("aspect") === "9:16" ? "9:16" : "16:9",
    duration: Number(get("duration")),
    script: get("script"),
    narration: get("narration") === "true",
    songId: get("songId") || null,
    splitPanels: get("mode") === "manga" && get("splitPanels") === "true",
    readingOrder: get("readingOrder") === "ltr" ? "ltr" : "rtl",
    multiVoice: get("narration") === "true" && get("multiVoice") === "true",
    sceneSync: get("sceneSync") === "music" ? "music" : "uniform",
    subtitles: get("subtitles") !== "false",
  };
  if (input.title.length < 2) return jsonError("Indica un título de al menos dos caracteres", 422);
  if (![15, 30, 60].includes(input.duration)) return jsonError("Selecciona 15, 30 o 60 segundos", 422);
  if (input.script.length > 3000) return jsonError("El guion no puede superar 3000 caracteres", 422);
  const files = form.getAll("files");
  if ((input.mode !== "letra" && !files.length) || files.length > 13 || files.some((f) => !(f instanceof File))) {
    return jsonError("Sube entre 1 y 12 imágenes o páginas, y opcionalmente una pista de audio", 422);
  }
  if (files.reduce((sum, f) => sum + (f instanceof File ? f.size : 0), 0) > LIMIT) return jsonError("Los archivos superan 24 MB", 413);
  try {
    const media = await Promise.all(files.map(async (f) => ({
      name: (f as File).name, bytes: Buffer.from(await (f as File).arrayBuffer()),
    })));
    const video = await createVideo(auth.user.id, input, media);
    return Response.json(video, {status:201});
  } catch(e) {
    if (e instanceof VideoError) return jsonError(e.message,e.status);
    if (e instanceof StorageQuotaError) return jsonError(e.message,413);
    console.error("[videos] create",e);
    return jsonError("No se pudo guardar el proyecto de video", 500);
  }
}
