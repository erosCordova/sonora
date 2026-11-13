import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { and, count, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, songs, workers, type Job, type Song } from "@/db/schema";
import { buildCaption, LANGUAGES } from "@/lib/music-options";
import { generateLyrics, interpretPrompt, llmConfig, LlmError } from "@/lib/llm";
import { putObject, removeObject, sniffAudio } from "@/lib/storage";
import type { EditInput, GenerateInput } from "@/lib/schemas";
import type { WorkerLease } from "@/lib/worker-lease";

export const ENGINE = process.env.MUSIC_ENGINE ?? "acestep";
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_JOBS ?? 4);
const MAX_PER_DAY = Number(process.env.MAX_JOBS_PER_DAY ?? 40);
const STALE_SECONDS = 120;
const WORKER_ONLINE_SECONDS = 30;

/** Comprueba un heartbeat RECIENTE del motor exacto antes de aceptar tareas nuevas. */
async function assertWorkerAvailable(engine: string): Promise<void> {
  if (process.env.REQUIRE_ONLINE_WORKER !== "true") return;
  const cutoff = new Date(Date.now() - WORKER_ONLINE_SECONDS * 1000);
  const [available] = await db.select({ id: workers.id }).from(workers)
    .where(and(eq(workers.engine, engine), gte(workers.lastSeenAt, cutoff))).limit(1);
  if (!available) throw new JobError(
    "No hay un motor musical conectado. Tu canción no se ha enviado a la cola. Activa un worker ACE-Step antes de intentarlo de nuevo.",
    503,
  );
}

export class JobError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function assertQuota(userId: string, newJobs: number) {
  const [active] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), inArray(jobs.status, ["pending", "running"])));
  if (active.n + newJobs > MAX_ACTIVE)
    throw new JobError(`Tienes ${active.n} tareas activas. El máximo simultáneo es ${MAX_ACTIVE}; espera a que terminen o cancélalas.`, 429);
  const [day] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), gte(jobs.createdAt, new Date(Date.now() - 86400_000))));
  if (day.n + newJobs > MAX_PER_DAY)
    throw new JobError(`Has alcanzado el límite de ${MAX_PER_DAY} generaciones en 24 horas.`, 429);
}

export interface GenerateJobParams {
  mode: "simple" | "custom";
  prompt: string;
  caption: string;
  lyrics: string;
  language: string; // código ISO o "auto"
  instrumental: boolean;
  bpm: number | null;
  duration: number | null;
  genre: string;
  subgenre: string;
  vocal: string;
  voiceStyle: string;
  instruments: string[];
  mood: string;
  intensity: string;
  structure: string;
  // true => el worker debe pedir al LM de ACE-Step (create_sample) que componga letra/caption
  needsCreateSample: boolean;
}

export async function createGenerateJobs(userId: string, input: GenerateInput) {
  await assertWorkerAvailable(ENGINE);
  await assertQuota(userId, input.variations);
  const instrumental = input.vocal === "instrumental";
  const llm = llmConfig().configured;
  let caption = "";
  let lyrics = input.lyrics;
  let title = input.title;
  let language = input.language;
  let bpm = input.bpm;
  let needsCreateSample = false;

  if (input.mode === "simple") {
    caption = input.prompt;
    lyrics = "";
    if (llm) {
      try {
        const r = await interpretPrompt({ prompt: input.prompt, instrumental, language });
        caption = r.caption;
        lyrics = r.lyrics;
        title = title || r.title;
        language = r.language;
        bpm = bpm ?? r.bpm;
      } catch (e) {
        if (!(e instanceof LlmError)) throw e;
        needsCreateSample = !instrumental; // el LM de ACE-Step compondrá la letra
      }
    } else {
      needsCreateSample = !instrumental;
    }
  } else {
    caption = buildCaption({ ...input, bpm });
    if (input.prompt) caption = `${caption}, ${input.prompt}`;
    if (instrumental) lyrics = "[Instrumental]";
    else if (!lyrics) {
      if (llm) {
        lyrics = await generateLyrics({
          theme: input.prompt || `${input.genre} ${input.mood}`.trim() || "a personal story",
          language: language === "auto" ? "es" : language,
          length: "medium",
          structure: input.structure || "classic",
          genre: input.genre,
          mood: input.mood,
        });
      } else needsCreateSample = true;
    }
  }

  const groupId = randomUUID();
  const params: GenerateJobParams = {
    mode: input.mode,
    prompt: input.prompt,
    caption,
    lyrics: instrumental ? "[Instrumental]" : lyrics,
    language: instrumental ? "" : language,
    instrumental,
    bpm,
    duration: input.duration,
    genre: input.genre,
    subgenre: input.subgenre,
    vocal: input.vocal,
    voiceStyle: input.voiceStyle,
    instruments: input.instruments,
    mood: input.mood,
    intensity: input.intensity,
    structure: input.structure,
    needsCreateSample,
  };
  const rows = await db
    .insert(jobs)
    .values(
      Array.from({ length: input.variations }, (_, i) => ({
        userId,
        groupId,
        kind: "generate",
        title: title ? (input.variations > 1 ? `${title} (${i + 1})` : title) : "",
        params: params as unknown as Record<string, unknown>,
        engine: ENGINE,
      })),
    )
    .returning();
  return rows;
}

export async function createEditJobs(userId: string, input: EditInput) {
  const [song] = await db
    .select()
    .from(songs)
    .where(and(eq(songs.id, input.songId), eq(songs.userId, userId)))
    .limit(1);
  if (!song) throw new JobError("Canción no encontrada", 404);
  await assertWorkerAvailable(song.engine || ENGINE);
  const n = input.operation === "variation" ? input.variations : 1;
  await assertQuota(userId, n);

  const base = {
    sourceDuration: song.durationSec,
    caption: song.caption,
    lyrics: song.lyrics,
    language: song.language,
    vocal: song.vocal,
    genre: song.genre,
    subgenre: song.subgenre,
  };
  let kind: string;
  let params: Record<string, unknown>;
  let suffix: string;
  switch (input.operation) {
    case "variation":
      kind = "cover";
      suffix = "variación";
      params = { ...base, operation: "variation", strength: 0.85 };
      break;
    case "restyle":
      kind = "cover";
      suffix = "nuevo estilo";
      params = {
        ...base,
        operation: "restyle",
        caption: input.caption,
        lyrics: input.lyrics || song.lyrics,
        language: input.language || song.language,
        strength: input.strength,
      };
      break;
    case "extend":
      kind = "repaint";
      suffix = "extendida";
      params = {
        ...base,
        operation: "extend",
        caption: input.caption || song.caption,
        lyrics: input.lyrics || song.lyrics,
        start: song.durationSec,
        end: song.durationSec + input.seconds,
      };
      break;
    case "repaint": {
      if (input.end <= input.start) throw new JobError("El final debe ser posterior al inicio", 422);
      if (input.end > song.durationSec + 0.5) throw new JobError("El fragmento excede la duración de la canción", 422);
      if (input.end - input.start < 3) throw new JobError("El fragmento debe durar al menos 3 segundos", 422);
      kind = "repaint";
      suffix = "fragmento regenerado";
      params = {
        ...base,
        operation: "repaint",
        caption: input.caption || song.caption,
        lyrics: input.lyrics || song.lyrics,
        start: input.start,
        end: Math.min(input.end, song.durationSec),
      };
      break;
    }
  }
  const groupId = randomUUID();
  return db
    .insert(jobs)
    .values(
      Array.from({ length: n }, (_, i) => ({
        userId,
        groupId,
        kind,
        title: `${song.title} (${suffix}${n > 1 ? ` ${i + 1}` : ""})`,
        params,
        parentSongId: song.id,
        engine: song.engine || ENGINE,
      })),
    )
    .returning();
}

/** Re-encola o falla tareas cuyo worker dejó de dar señales. */
export async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_SECONDS * 1000);
  // La condición de latido se evalúa en el UPDATE, no en una consulta anterior:
  // un latido que llegue entre ambas operaciones no debe perder su tarea.
  const stale = and(eq(jobs.status, "running"), or(lt(jobs.heartbeatAt, cutoff), sql`${jobs.heartbeatAt} is null`));
  await db.update(jobs)
    .set({ status: "pending", stage: "Reintentando: el motor dejó de responder", progress: null, workerId: null, heartbeatAt: null })
    .where(and(stale, sql`${jobs.attempts} < ${jobs.maxAttempts}`));
  await db.update(jobs)
    .set({
      status: "failed",
      error: "El motor dejó de responder durante la generación y se agotaron los reintentos.",
      stage: "Fallida",
      finishedAt: new Date(),
    })
    .where(and(stale, sql`${jobs.attempts} >= ${jobs.maxAttempts}`));
}

export async function claimJob(workerId: string, engine: string): Promise<Job | null> {
  await recoverStaleJobs();
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, worker_id = ${workerId},
      started_at = now(), heartbeat_at = now(), stage = 'Preparando', progress = NULL, error = NULL
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'pending' AND engine = ${engine}
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const id = (res.rows[0] as { id: string } | undefined)?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

export interface CompleteMeta {
  durationSec: number;
  model: string;
  modelVersion?: string;
  caption?: string;
  lyrics?: string;
  bpm?: number | null;
  keyscale?: string;
  language?: string;
  title?: string;
  seed?: number | null;
}

/** Valida el archivo generado, lo guarda de forma persistente y crea la canción. */
export async function finalizeJob(job: Job, file: Buffer, meta: CompleteMeta, lease: WorkerLease): Promise<Song> {
  const sniff = sniffAudio(file);
  if (!sniff) throw new JobError("El archivo recibido no es un audio válido (firma binaria desconocida)", 422);
  if (!(meta.durationSec > 1)) throw new JobError("Duración de audio inválida", 422);
  const p = job.params as Record<string, unknown>;
  const [parent] = job.parentSongId
    ? await db.select().from(songs).where(eq(songs.id, job.parentSongId))
    : [];
  const id = randomUUID();
  const key = `${job.userId}/${id}.${sniff.ext}`;
  await putObject(key, file);

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const op = str(p.operation);
  const kindMap: Record<string, string> = {
    variation: "variation",
    restyle: "restyle",
    extend: "extend",
    repaint: "repaint",
  };
  const genreName = str(p.genre) || parent?.genre || "";
  const title = (
    job.title ||
    meta.title ||
    parent?.title ||
    `${genreName || "Canción"} · ${new Date().toLocaleDateString("es", { day: "numeric", month: "short" })}`
  ).slice(0, 120);
  const caption = meta.caption || str(p.caption) || parent?.caption || "";
  const lyrics = meta.lyrics ?? (str(p.lyrics) || parent?.lyrics || "");
  const language = str(p.language) && p.language !== "auto" ? str(p.language) : meta.language || parent?.language || "";
  try {
    return await db.transaction(async (tx) => {
      // Actualizar primero obtiene un bloqueo de fila y asegura que solo un
      // intento vigente pueda completar la tarea, incluso con subidas simultáneas.
      const [done] = await tx.update(jobs)
        .set({ status: "completed", songId: id, progress: 1, stage: "Completada", finishedAt: new Date(), error: null })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.workerId, lease.workerId), eq(jobs.attempts, lease.attempt)))
        .returning({ id: jobs.id });
      if (!done) throw new JobError("La tarea ya no pertenece a este intento; resultado descartado", 409);
      const [song] = await tx.insert(songs)
      .values({
        id,
        userId: job.userId,
        jobId: job.id,
        parentId: parent?.id ?? null,
        rootId: parent ? (parent.rootId ?? parent.id) : id,
        versionKind: kindMap[op] ?? "original",
        title,
        prompt: str(p.prompt) || parent?.prompt || "",
        caption,
        lyrics,
        genre: str(p.genre) || parent?.genre || "",
        subgenre: str(p.subgenre) || parent?.subgenre || "",
        language,
        vocal: str(p.vocal) || parent?.vocal || (lyrics.trim() === "[Instrumental]" ? "instrumental" : "male"),
        params: { ...p, bpm: meta.bpm ?? p.bpm ?? null, keyscale: meta.keyscale ?? null, seed: meta.seed ?? null },
        engine: job.engine,
        model: meta.model,
        modelVersion: meta.modelVersion ?? "",
        durationSec: meta.durationSec,
        audioKey: key,
        audioMime: sniff.mime,
        audioBytes: file.length,
        coverSeed: randomBytes(6).toString("hex"),
      })
      .returning();
      return song;
    });
  } catch (e) {
    await removeObject(key).catch(() => {});
    throw e;
  }
}

export function serializeJob(j: Job) {
  return {
    id: j.id,
    groupId: j.groupId,
    kind: j.kind,
    status: j.status,
    title: j.title,
    stage: j.stage,
    progress: j.progress,
    error: j.error,
    attempts: j.attempts,
    songId: j.songId,
    parentSongId: j.parentSongId,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

export async function userJobs(userId: string) {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        or(
          inArray(jobs.status, ["pending", "running"]),
          gte(jobs.finishedAt, new Date(Date.now() - 15 * 60_000)),
        ),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(30);
  return rows.map(serializeJob);
}

export async function systemStatus() {
  const cutoff = new Date(Date.now() - WORKER_ONLINE_SECONDS * 1000);
  const ws = await db.select().from(workers).where(gte(workers.lastSeenAt, cutoff));
  const [q] = await db.select({ n: count() }).from(jobs).where(eq(jobs.status, "pending"));
  const [r] = await db.select({ n: count() }).from(jobs).where(eq(jobs.status, "running"));
  const llm = llmConfig();
  return {
    workers: ws.map((w) => ({ id: w.id, name: w.name, engine: w.engine, info: w.info, busy: Boolean(w.currentJobId) })),
    workerOnline: ws.some((w) => w.engine === ENGINE),
    queued: q.n,
    running: r.n,
    engine: ENGINE,
    llm: { configured: llm.configured, model: llm.configured ? llm.model : null },
    languages: LANGUAGES.length,
  };
}
