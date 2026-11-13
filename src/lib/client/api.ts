import type { SongDTO } from "@/lib/songs";

export type { SongDTO };

export interface JobDTO {
  id: string;
  groupId: string;
  kind: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  title: string;
  stage: string;
  progress: number | null;
  error: string | null;
  attempts: number;
  songId: string | null;
  parentSongId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SystemStatus {
  workers: { id: string; name: string; engine: string; info: Record<string, unknown>; busy: boolean }[];
  workerOnline: boolean;
  queued: number;
  running: number;
  engine: string;
  llm: { configured: boolean; model: string | null };
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new Error((data as { error?: string } | null)?.error ?? `Error ${res.status}`);
  }
  return data as T;
}

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });

export const VERSION_LABELS: Record<string, string> = {
  original: "Original",
  variation: "Variación",
  restyle: "Nuevo estilo",
  extend: "Extendida",
  repaint: "Fragmento regenerado",
  trim: "Recorte",
};
