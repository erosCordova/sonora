import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

// Dos almacenamientos compatibles: filesystem (volumen persistente) y PostgreSQL
// (base gratuita de tamaño limitado, sin disco persistente en el servidor web).
// Nunca guardar audios solo en el disco efímero de Render Free.
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { audioObjects } from "@/db/schema";

export class StorageQuotaError extends Error {
  constructor(message: string) { super(message); this.name = "StorageQuotaError"; }
}

export function storageBackend() {
  const mode = process.env.STORAGE_BACKEND ?? "filesystem";
  if (mode !== "filesystem" && mode !== "postgres") throw new Error("STORAGE_BACKEND debe ser filesystem o postgres");
  return mode;
}

const root = () => path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./storage");

function safePath(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Clave de almacenamiento inválida");
  return full;
}

export async function putObject(key: string, data: Buffer) {
  safePath(key); // valida rutas incluso cuando el driver es PostgreSQL
  if (storageBackend() === "postgres") {
    // Render Postgres Free dispone de 1 GB para TODA la base de datos.
    const maxBytes = Number(process.env.POSTGRES_AUDIO_MAX_BYTES ?? 50 * 1024 * 1024);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("POSTGRES_AUDIO_MAX_BYTES inválido");
    if (data.byteLength > maxBytes) throw new StorageQuotaError(`Audio de ${Math.ceil(data.byteLength / 1048576)} MB: máximo configurado ${Math.floor(maxBytes / 1048576)} MB. Reduce la duración o usa almacenamiento de objetos.`);
    await db.insert(audioObjects).values({ key, bytes: data.byteLength, content: data });
    return;
  }
  const full = safePath(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, full);
}

export async function statObject(key: string): Promise<{ size: number } | null> {
  safePath(key);
  if (storageBackend() === "postgres") {
    const [row] = await db.select({ size: audioObjects.bytes }).from(audioObjects).where(eq(audioObjects.key, key)).limit(1);
    return row ?? null;
  }
  try {
    const st = await fsp.stat(/* turbopackIgnore: true */ safePath(key));
    return { size: st.size };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function streamObject(key: string, start?: number, end?: number) {
  safePath(key);
  if (storageBackend() === "postgres") {
    // Solo se recupera el rango solicitado para no copiar un WAV completo en cada seek.
    const from = Math.max(0, start ?? 0);
    const length = end === undefined ? null : Math.max(0, end - from + 1);
    const result = await pool.query<{ content: Buffer }>(
      "SELECT substring(content FROM $2::integer FOR COALESCE($3::integer, bytes)) AS content FROM audio_objects WHERE key = $1",
      [key, from + 1, length],
    );
    if (!result.rows[0]) throw new Error("Audio no encontrado en PostgreSQL");
    return Readable.from([result.rows[0].content]);
  }
  return fs.createReadStream(/* turbopackIgnore: true */ safePath(key), { start, end });
}

export async function readObject(key: string) {
  safePath(key);
  if (storageBackend() === "postgres") {
    const [row] = await db.select({ content: audioObjects.content }).from(audioObjects).where(eq(audioObjects.key, key)).limit(1);
    if (!row) throw new Error("Audio no encontrado en PostgreSQL");
    return row.content;
  }
  return fsp.readFile(/* turbopackIgnore: true */ safePath(key));
}

export async function removeObject(key: string) {
  safePath(key);
  if (storageBackend() === "postgres") {
    await db.delete(audioObjects).where(eq(audioObjects.key, key));
    return;
  }
  await fsp.rm(/* turbopackIgnore: true */ safePath(key), { force: true });
}

// ---- URLs temporales firmadas (HMAC) ----
function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 16) throw new Error("APP_SECRET no configurado (mínimo 16 caracteres)");
  return s;
}

export function signAudioToken(songId: string, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac("sha256", secret()).update(`${songId}.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyAudioToken(songId: string, token: string) {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  const expected = createHmac("sha256", secret()).update(`${songId}.${exp}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Validación de archivos de audio por firma binaria ----
export function sniffAudio(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  const head4 = buf.subarray(0, 4).toString("latin1");
  if (head4 === "fLaC") return { mime: "audio/flac", ext: "flac" };
  if (head4 === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WAVE") return { mime: "audio/wav", ext: "wav" };
  if (head4 === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  if (buf.subarray(0, 3).toString("latin1") === "ID3") return { mime: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { mime: "audio/mpeg", ext: "mp3" };
  return null;
}

/** Duración exacta de un WAV PCM a partir de su cabecera (para recortes). */
export function wavDuration(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  let off = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (off + 8 <= buf.length) {
    const id = buf.subarray(off, off + 4).toString("latin1");
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      dataSize = Math.min(size, buf.length - off - 8);
      break;
    }
    off += 8 + size + (size % 2);
  }
  return byteRate && dataSize ? dataSize / byteRate : null;
}
