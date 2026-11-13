import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { jsonError, withUser } from "@/lib/http";
import { limited, rateLimit } from "@/lib/ratelimit";
import { getOwnedSong, serializeSong } from "@/lib/songs";
import { putObject, sniffAudio, wavDuration, StorageQuotaError, removeObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
const MAX_BYTES = 80 * 1024 * 1024;

// Recorte: el navegador decodifica el original, corta el fragmento y sube un WAV.
// Se crea una NUEVA versión vinculada; el original no se modifica.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await withUser();
  if (a.res) return a.res;
  const rl = rateLimit(`trim:${a.user.id}`, 20, 3600_000);
  if (!rl.ok) return limited(rl.retryAfter);
  const { id } = await ctx.params;
  const parent = await getOwnedSong(id, a.user.id);
  if (!parent) return jsonError("Canción no encontrada", 404);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 4096) return jsonError("Archivo demasiado grande", 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Formulario inválido", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Falta el archivo", 422);
  if (file.size > MAX_BYTES) return jsonError("Archivo demasiado grande", 413);
  const buf = Buffer.from(await file.arrayBuffer());
  const sniff = sniffAudio(buf);
  if (!sniff || sniff.ext !== "wav") return jsonError("El recorte debe ser un WAV válido", 422);
  const dur = wavDuration(buf);
  if (!dur || dur < 1 || dur > parent.durationSec + 1) return jsonError("Duración de recorte inválida", 422);

  const newId = randomUUID();
  const key = `${a.user.id}/${newId}.wav`;
  try {
    await putObject(key, buf);
  } catch (e) {
    if (e instanceof StorageQuotaError) return jsonError(e.message, 413);
    throw e;
  }
  let song;
  try {
    [song] = await db
    .insert(songs)
    .values({
      id: newId,
      userId: a.user.id,
      parentId: parent.id,
      rootId: parent.rootId ?? parent.id,
      versionKind: "trim",
      title: `${parent.title} (recorte)`.slice(0, 120),
      prompt: parent.prompt,
      caption: parent.caption,
      lyrics: parent.lyrics,
      genre: parent.genre,
      subgenre: parent.subgenre,
      language: parent.language,
      vocal: parent.vocal,
      params: { ...parent.params, operation: "trim" },
      engine: parent.engine,
      model: parent.model,
      modelVersion: parent.modelVersion,
      durationSec: dur,
      audioKey: key,
      audioMime: "audio/wav",
      audioBytes: buf.length,
      coverSeed: randomBytes(6).toString("hex"),
    })
    .returning();
  } catch (e) {
    await removeObject(key).catch(() => {});
    throw e;
  }
  return Response.json({ song: serializeSong(song, a.user.id) }, { status: 201 });
}
