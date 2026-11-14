import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { jobs, songs, videos, workers, type Job } from "@/db/schema";
import { putObject, removeObject, StorageQuotaError } from "@/lib/storage";
import type { WorkerLease } from "@/lib/worker-lease";

export const VIDEO_ENGINE = "sonora-video";
const MAX_BUNDLE = 24 * 1024 * 1024;
const MAX_FILE = 16 * 1024 * 1024;
export class VideoError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

const fileTypes: Record<string, string> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
  ".zip": "archive", ".cbz": "archive", ".pdf": "pdf",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".flac": "audio",
};

export function validateVideoFile(name: string, data: Buffer): string {
  const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  const kind = fileTypes[ext];
  if (!kind || !data.length || data.length > MAX_FILE) throw new VideoError("Archivo no compatible o demasiado grande (máximo 16 MB por archivo)");
  const head = data.subarray(0, 16);
  const ascii = head.toString("latin1");
  if (ext === ".png" && !head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new VideoError("PNG inválido");
  if ([".jpg", ".jpeg"].includes(ext) && !(head[0] === 255 && head[1] === 216)) throw new VideoError("JPEG inválido");
  if (ext === ".webp" && !(ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP")) throw new VideoError("WEBP inválido");
  if ([".zip", ".cbz"].includes(ext) && !ascii.startsWith("PK\u0003\u0004")) throw new VideoError("ZIP/CBZ inválido");
  if (ext === ".pdf" && !ascii.startsWith("%PDF-")) throw new VideoError("PDF inválido");
  if (ext === ".wav" && !(ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE")) throw new VideoError("WAV inválido");
  if (ext === ".flac" && !ascii.startsWith("fLaC")) throw new VideoError("FLAC inválido");
  if (ext === ".mp3" && !(ascii.startsWith("ID3") || (head[0] === 255 && (head[1] & 224) === 224))) throw new VideoError("MP3 inválido");
  if (ext === ".m4a" && ascii.slice(4, 8) !== "ftyp") throw new VideoError("M4A inválido");
  return kind;
}

export function packVideoFiles(input: { name: string; bytes: Buffer }[], allowNoVisuals = false): Buffer {
  if ((!input.length && !allowNoVisuals) || input.length > 13) throw new VideoError("Adjunta hasta 12 imágenes/capítulos y, opcionalmente, un audio");
  const manifest = input.map((f, i) => ({
    name: `asset_${String(i).padStart(2, "0")}${f.name.toLowerCase().match(/\.[^.]+$/)?.[0] || ""}`,
    kind: validateVideoFile(f.name, f.bytes),
    length: f.bytes.length,
  }));
  if (manifest.filter((f) => f.kind === "audio").length > 1) throw new VideoError("Solo puedes subir una pista de audio");
  if (!allowNoVisuals && !manifest.some((f) => f.kind !== "audio")) throw new VideoError("Sube al menos una imagen, página o capítulo");
  const header = Buffer.from(JSON.stringify({ version: 1, files: manifest }), "utf8");
  if (header.length > 8192) throw new VideoError("Demasiados archivos");
  const prefix = Buffer.alloc(9);
  prefix.write("SNV01", 0, "ascii");
  prefix.writeUInt32BE(header.length, 5);
  const bundle = Buffer.concat([prefix, header, ...input.map((f) => f.bytes)]);
  if (bundle.length > MAX_BUNDLE) throw new VideoError("Los archivos superan 24 MB; reduce las imágenes o utiliza otro capítulo");
  return bundle;
}

export type NewVideo = {
  title: string;
  mode: "imagenes" | "manga" | "letra";
  aspect: "16:9" | "9:16";
  duration: number;
  script: string;
  narration: boolean;
  songId: string | null;
  splitPanels: boolean;
  readingOrder: "rtl" | "ltr";
  multiVoice: boolean;
  sceneSync: "uniform" | "music";
  subtitles: boolean;
};

export async function createVideo(userId: string, input: NewVideo, attachments: {name:string; bytes:Buffer}[]) {
  const cutoff = new Date(Date.now() - 30_000);
  const [worker] = await db.select({ id: workers.id }).from(workers)
    .where(and(eq(workers.engine, VIDEO_ENGINE), gte(workers.lastSeenAt, cutoff))).limit(1);
  if (!worker) throw new VideoError("El motor de video local está desconectado. Actualiza el complemento de Sonora en ComfyUI y vuelve a conectarlo.", 503);
  if (input.narration && !input.script.trim()) throw new VideoError("Escribe el guion antes de activar las voces");
  if (!input.songId && !input.narration && !attachments.some((f) => /\.(mp3|wav|m4a|flac)$/i.test(f.name))) {
    throw new VideoError("Selecciona una canción, sube un audio o activa la narración para obtener un video con sonido");
  }
  let songId: string | null = null;
  let songLyrics = "";
  if (input.songId) {
    const [song] = await db.select({ id: songs.id, lyrics: songs.lyrics }).from(songs)
      .where(and(eq(songs.id, input.songId), eq(songs.userId, userId))).limit(1);
    if (!song) throw new VideoError("La canción seleccionada no pertenece a tu biblioteca", 404);
    songId = song.id;
    songLyrics = song.lyrics;
  }
  if (input.mode === "letra" && !input.script.trim() && !songLyrics.trim()) {
    throw new VideoError("Para crear un videoclip lírico, selecciona una canción con letra o escribe la letra manualmente");
  }
  const resolvedInput = input.mode === "letra"
    ? { ...input, script: (input.script.trim() || songLyrics).slice(0, 3000), subtitles: true }
    : input;
  const [active] = await db.select({ n: count() }).from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.engine, VIDEO_ENGINE), eq(jobs.status, "pending")));
  if (active.n >= 3) throw new VideoError("Tienes demasiados videos en cola; espera a que se complete uno", 429);
  const bundle = packVideoFiles(attachments,input.mode === "letra");
  const videoId = randomUUID(), jobId = randomUUID();
  const sourceKey = `${userId}/video-input/${videoId}.bundle`;
  await putObject(sourceKey, bundle);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(jobs).values({ id: jobId, userId, groupId: randomUUID(), kind: "video", engine: VIDEO_ENGINE,
        title: input.title, params: { ...resolvedInput, videoId }, parentSongId: songId,
        maxAttempts: 1 });
      await tx.insert(videos).values({ id: videoId, userId, jobId, title: input.title,
        mode: input.mode, sourceKey, songId, aspect: input.aspect });
    });
    return { id: videoId, jobId };
  } catch (e) {
    await removeObject(sourceKey).catch(() => {});
    throw e;
  }
}

export async function listVideos(userId: string) {
  const data = await db.select({ video: videos, job: jobs }).from(videos)
    .innerJoin(jobs, eq(videos.jobId, jobs.id))
    .where(eq(videos.userId, userId)).orderBy(desc(videos.createdAt)).limit(50);
  return data.map(({video,job}) => ({
    id: video.id, jobId: job.id, title: video.title, mode: video.mode, aspect: video.aspect, createdAt: video.createdAt,
    durationSec: video.durationSec, ready: Boolean(video.outputKey) && job.status === "completed",
    status: job.status, stage: job.stage, error: job.error, progress: job.progress,
  }));
}

export async function finalizeVideoJob(job: Job, file: Buffer, durationSec: number, lease: WorkerLease) {
  if (job.kind !== "video" || job.engine !== VIDEO_ENGINE) throw new VideoError("La tarea no es un video", 422);
  if (!file.length || file.length > 40 * 1024 * 1024 || file.toString("ascii", 4, 8) !== "ftyp") {
    throw new VideoError("No se recibió un MP4 válido o supera los 40 MB", 422);
  }
  if (!(durationSec >= 1 && durationSec <= 65)) throw new VideoError("Duración de MP4 inválida", 422);
  const [video] = await db.select().from(videos).where(eq(videos.jobId, job.id)).limit(1);
  if (!video) throw new VideoError("Proyecto de video no encontrado", 404);
  const outputKey = `${job.userId}/video-output/${video.id}.mp4`;
  await putObject(outputKey, file);
  try {
    await db.transaction(async (tx) => {
      const [done] = await tx.update(jobs).set({status: "completed", stage: "Completado",progress: 1,
        finishedAt: new Date(),error: null}).where(and(eq(jobs.id, job.id), eq(jobs.status,"running"),
        eq(jobs.workerId, lease.workerId), eq(jobs.attempts, lease.attempt))).returning({id:jobs.id});
      if (!done) throw new VideoError("El intento de video ya no está activo",409);
      await tx.update(videos).set({outputKey,durationSec,bytes:file.length})
        .where(eq(videos.id,video.id));
    });
    await removeObject(video.sourceKey).catch((e) => console.warn("[video] No se pudo limpiar material de entrada:", e));
    return video.id;
  } catch(e) {
    await removeObject(outputKey).catch(() => {});
    throw e;
  }
}

/** Disponibilidad real del motor audiovisual, separada del motor de música. */
export async function videoMotorStatus() {
  const cutoff = new Date(Date.now() - 30_000);
  const [online, pending, running] = await Promise.all([
    db.select({ id: workers.id }).from(workers)
      .where(and(eq(workers.engine, VIDEO_ENGINE),gte(workers.lastSeenAt,cutoff))).limit(1),
    db.select({ n: count() }).from(jobs)
      .where(and(eq(jobs.engine,VIDEO_ENGINE),eq(jobs.status,"pending"))),
    db.select({ n: count() }).from(jobs)
      .where(and(eq(jobs.engine,VIDEO_ENGINE),eq(jobs.status,"running"))),
  ]);
  return { online: online.length > 0, pending: pending[0]?.n ?? 0, running: running[0]?.n ?? 0 };
}
