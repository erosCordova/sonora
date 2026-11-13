import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

// Almacenamiento persistente de audio.
// Driver actual: disco local (STORAGE_DIR). Debe montarse como volumen persistente
// en producción. La interfaz (put/stat/stream/remove) permite reemplazarlo por S3/Supabase.

const root = () => path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./storage");

function safePath(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Clave de almacenamiento inválida");
  return full;
}

export async function putObject(key: string, data: Buffer) {
  const full = safePath(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, full);
}

export async function statObject(key: string) {
  try {
    return await fsp.stat(/* turbopackIgnore: true */ safePath(key));
  } catch {
    return null;
  }
}

export function streamObject(key: string, start?: number, end?: number) {
  return fs.createReadStream(/* turbopackIgnore: true */ safePath(key), { start, end });
}

export async function readObject(key: string) {
  return fsp.readFile(/* turbopackIgnore: true */ safePath(key));
}

export async function removeObject(key: string) {
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
