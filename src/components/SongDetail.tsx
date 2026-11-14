"use client";
import { Download, Loader2, Play, Scissors } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Cover } from "@/components/Cover";
import { Button, Chip, Field, Input, Modal, Textarea, cx } from "@/components/ui";
import { api, fmtDate, fmtTime, VERSION_LABELS, type JobDTO, type SongDTO } from "@/lib/client/api";
import { languageLabel } from "@/lib/music-options";
import { trimToWav } from "@/lib/client/wav";
import { useJobs } from "@/stores/jobs";
import { usePlayer } from "@/stores/player";
import { toast } from "@/stores/toast";

type Tool = "variation" | "restyle" | "extend" | "repaint" | "trim";

const TOOLS: { id: Tool; label: string; desc: string }[] = [
  { id: "variation", label: "Variación", desc: "Genera una nueva toma con la misma esencia (cover con fuerza alta)." },
  { id: "restyle", label: "Estilo / letra", desc: "Reinterpreta la canción con otro estilo o con una letra modificada, conservando la estructura." },
  { id: "extend", label: "Extender", desc: "Continúa la canción al final (repaint más allá del final del audio)." },
  { id: "repaint", label: "Regenerar fragmento", desc: "Vuelve a generar solo un tramo y conserva el resto." },
  { id: "trim", label: "Recortar", desc: "Corta un fragmento y guárdalo como nueva versión (se procesa en tu navegador)." },
];

export function SongDetail({ songId, onClose, onChanged }: { songId: string | null; onClose: () => void; onChanged: () => void }) {
  const [loaded, setLoaded] = useState<{ id: string; data: { song: SongDTO; versions: SongDTO[] } } | null>(null);
  const [selection, setSelection] = useState<{ rootId: string | null; id: string | null }>({ rootId: songId, id: songId });
  const currentId = selection.rootId === songId ? selection.id : songId;
  // Mantener fuera de pantalla los datos de una versión anterior durante la carga.
  const data = loaded?.id === currentId ? loaded.data : null;
  const [tool, setTool] = useState<Tool>("trim");
  const [busy, setBusy] = useState(false);
  const system = useJobs((s) => s.system);
  const aiEditAvailable = Boolean(system?.workers.some((w) => {
    if (w.engine !== system.engine) return false;
    const caps = w.info.capabilities;
    return Array.isArray(caps) ? caps.includes("cover") && caps.includes("repaint") : w.info.backend !== "ComfyUI";
  }));

  const [variations, setVariations] = useState(1);
  const [caption, setCaption] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [strength, setStrength] = useState(0.6);
  const [seconds, setSeconds] = useState(30);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(10);

  const load = useCallback(async (id: string) => {
    try {
      const d = await api<{ song: SongDTO; versions: SongDTO[] }>(`/api/songs/${id}`);
      setLoaded({ id, data: d });
      setCaption(d.song.caption);
      setLyrics(d.song.lyrics === "[Instrumental]" ? "" : d.song.lyrics);
      setStart(0);
      setEnd(Math.min(10, Math.floor(d.song.durationSec)));
    } catch (e) {
      toast.error((e as Error).message);
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    // La carga es asíncrona y se cancela si cambia la versión seleccionada.
    if (!currentId) return;
    const timer = window.setTimeout(() => void load(currentId), 0);
    return () => window.clearTimeout(timer);
  }, [currentId, load]);

  if (!songId) return null;
  const s = data?.song;

  async function submit() {
    if (!s) return;
    setBusy(true);
    try {
      if (tool === "trim") {
        if (end - start < 1) throw new Error("El recorte debe durar al menos 1 segundo");
        const { url } = await api<{ url: string }>(`/api/songs/${s.id}/url`);
        const wav = await trimToWav(url, start, end);
        const fd = new FormData();
        fd.append("file", wav, "trim.wav");
        const r = await fetch(`/api/songs/${s.id}/trim`, { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el recorte");
        toast.success("Recorte guardado como nueva versión");
        await load(s.id);
        onChanged();
        return;
      }
      const base = { songId: s.id };
      const body =
        tool === "variation" ? { operation: "variation", ...base, variations }
        : tool === "restyle" ? { operation: "restyle", ...base, caption, lyrics, strength }
        : tool === "extend" ? { operation: "extend", ...base, seconds, caption, lyrics }
        : { operation: "repaint", ...base, start, end, caption, lyrics };
      const r = await api<{ jobs: JobDTO[] }>("/api/jobs/edit", { method: "POST", json: body });
      useJobs.getState().track(r.jobs);
      toast.info("Tarea creada. Seguirás su progreso real en el indicador de procesos.");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string) {
    const { url } = await api<{ url: string }>(`/api/songs/${id}/url?download=1`);
    const a = document.createElement("a");
    a.href = url;
    a.click();
  }

  const desc = TOOLS.find((t) => t.id === tool)!;

  return (
    <Modal open onClose={onClose} title="Detalles y edición" wide>
      {!s ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex gap-4">
            <Cover seed={s.coverSeed} className="h-24 w-24 shrink-0 rounded-2xl shadow-lg sm:h-32 sm:w-32" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display text-xl font-bold">{s.title}</h3>
              <p className="text-sm text-muted">
                {[s.genre, s.subgenre, s.language && languageLabel(s.language), s.vocal === "instrumental" ? "Instrumental" : "Con voz"].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-muted">
                {fmtTime(s.durationSec)} · {fmtDate(s.createdAt)} · {s.engine} / {s.model}{s.modelVersion ? ` (${s.modelVersion})` : ""} · {(s.audioBytes / 1048576).toFixed(1)} MB
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => usePlayer.getState().playQueue([s])}><Play className="h-3.5 w-3.5" />Reproducir</Button>
                <Button size="sm" onClick={() => download(s.id)}><Download className="h-3.5 w-3.5" />Descargar</Button>
              </div>
            </div>
          </div>

          {s.caption && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Descripción enviada al motor</p>
              <p className="rounded-xl bg-surface-2 p-3 text-sm">{s.caption}</p>
            </div>
          )}

          {s.lyrics.trim() && s.lyrics.trim() !== "[Instrumental]" && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">Letra</summary>
              <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-6">{s.lyrics}</pre>
            </details>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Historial de versiones ({data.versions.length})</p>
            <ul className="space-y-1.5">
              {data.versions.map((v) => (
                <li key={v.id} className={cx("flex items-center gap-3 rounded-xl border p-2", v.id === s.id ? "border-brand/60 bg-surface-2" : "border-line")}>
                  <Cover seed={v.coverSeed} className="h-10 w-10 shrink-0 rounded-lg" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelection({ rootId: songId, id: v.id })}>
                    <span className="block truncate text-sm font-medium">{v.title}</span>
                    <span className="block text-xs text-muted">{VERSION_LABELS[v.versionKind] ?? v.versionKind} · {fmtTime(v.durationSec)} · {fmtDate(v.createdAt)}</span>
                  </button>
                  <Button size="icon" variant="ghost" aria-label="Reproducir versión" onClick={() => usePlayer.getState().playQueue([v])}><Play className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Descargar versión" onClick={() => download(v.id)}><Download className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          </div>

          {s.isOwner && (
            <div className="rounded-2xl border border-line p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Crear nueva versión (el original no cambia)</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {TOOLS.filter((t) => aiEditAvailable || t.id === "trim").map((t) => <Chip key={t.id} active={tool === t.id} onClick={() => setTool(t.id)}>{t.id === "trim" && <Scissors className="mr-1 inline h-3 w-3" />}{t.label}</Chip>)}
              </div>
              <p className="mb-3 text-sm text-muted">{desc.desc}</p>
              {!aiEditAvailable && (
                <p className="mb-3 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                  El motor ComfyUI disponible genera canciones originales. Variaciones, cambios de estilo y extensiones
                  requieren un motor de edición; por ahora puedes recortar tus canciones sin perder el original.
                </p>
              )}

              {tool === "variation" && (
                <Field label="Variaciones independientes">
                  <div className="flex gap-2">{[1, 2].map((n) => <Chip key={n} active={variations === n} onClick={() => setVariations(n)}>{n}</Chip>)}</div>
                </Field>
              )}
              {(tool === "restyle" || tool === "extend" || tool === "repaint") && (
                <div className="space-y-3">
                  <Field label={tool === "restyle" ? "Nuevo estilo (descripción)" : "Descripción de estilo"}>
                    <Textarea rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={600} />
                  </Field>
                  {s.vocal !== "instrumental" && (
                    <Field label="Letra" hint="Vacío = conservar la actual">
                      <Textarea rows={5} value={lyrics} onChange={(e) => setLyrics(e.target.value)} maxLength={4000} className="font-mono text-[13px]" />
                    </Field>
                  )}
                </div>
              )}
              {tool === "restyle" && (
                <Field label={`Fuerza de conservación: ${strength.toFixed(2)}`} hint="Baja = cambio dramático · Alta = sutil" className="mt-3">
                  <input type="range" min={0.2} max={0.95} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
                </Field>
              )}
              {tool === "extend" && (
                <Field label={`Segundos a añadir: ${seconds}`} className="mt-3">
                  <input type="range" min={10} max={90} step={5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
                </Field>
              )}
              {(tool === "repaint" || tool === "trim") && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Inicio (s)"><Input type="number" min={0} max={Math.floor(s.durationSec)} step={0.5} value={start} onChange={(e) => setStart(Number(e.target.value))} /></Field>
                  <Field label="Fin (s)" hint={`máx. ${s.durationSec.toFixed(1)}`}><Input type="number" min={1} max={Math.ceil(s.durationSec)} step={0.5} value={end} onChange={(e) => setEnd(Number(e.target.value))} /></Field>
                </div>
              )}
              {tool !== "trim" && system && !system.workerOnline && (
                <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">El motor musical está desconectado; la tarea esperará hasta que vuelva a estar disponible.</p>
              )}
              <Button variant="primary" className="mt-4" loading={busy} disabled={tool !== "trim" && !aiEditAvailable} onClick={submit}>
                {tool === "trim" ? "Guardar recorte" : "Crear versión"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
