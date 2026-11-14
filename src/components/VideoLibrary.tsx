"use client";

import { CheckCircle2, Clapperboard, Download, Film, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, cx } from "@/components/ui";
import { api, fmtDate, fmtTime } from "@/lib/client/api";
import { toast } from "@/stores/toast";

type Video = {
  id: string; jobId: string; title: string; mode: string; aspect: string;
  ready: boolean; status: string; stage: string; error: string | null;
  progress: number | null; durationSec: number | null; createdAt: string;
};
type Filter = "todos" | "proceso" | "terminados";

export function VideoLibrary() {
  const [items, setItems] = useState<Video[]>([]);
  const [filter, setFilter] = useState<Filter>("todos");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { const response = await api<{videos: Video[]}>("/api/videos"); setItems(response.videos); }
    catch { /* Se conserva la última lista si Render está temporalmente inactivo. */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    const first = window.setTimeout(() => {if(alive)void refresh();}, 0);
    const timer = window.setInterval(() => {if(alive)void refresh();}, 8000);
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, [refresh]);

  async function cancel(video: Video) {
    setBusy(video.id);
    try {
      await api(`/api/jobs/${video.jobId}/cancel`, {method:"POST"});
      toast.info("El proyecto fue cancelado.");
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(null); }
  }
  async function remove(video: Video) {
    setBusy(video.id);
    try {
      await api(`/api/videos/${video.id}`, {method:"DELETE"});
      toast.success("Video eliminado de tu biblioteca.");
      setConfirmId(null);
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(null); }
  }
  const filtered = items.filter((video) => filter === "todos" ||
    (filter === "proceso" && ["pending","running"].includes(video.status)) ||
    (filter === "terminados" && ["completed","failed","cancelled"].includes(video.status)));

  return (
    <section className="mt-10 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-xl font-bold">Mis videos</h2>
          <p className="mt-1 text-sm text-muted">Tus videoclips, adaptaciones de manga e imágenes animadas.</p></div>
        <Link href="/videos" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-md shadow-brand/15 hover:brightness-110">
          <Plus className="h-4 w-4"/>Nuevo video
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar videos">
        {([{id:"todos",label:"Todos"},{id:"proceso",label:"En proceso"},{id:"terminados",label:"Finalizados"}] as const).map((option) => (
          <button type="button" key={option.id} aria-pressed={filter===option.id} onClick={()=>setFilter(option.id)}
            className={cx("rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
              filter===option.id ? "border-transparent bg-brand-gradient text-white" : "border-line bg-surface text-muted hover:border-brand/40 hover:text-fg")}
          >{option.label}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{filtered.length} proyecto(s)</span>
      </div>
      {loading && <Card><p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin"/>Cargando videos...</p></Card>}
      {!loading && filtered.length===0 && <div className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-12 text-center">
        <Film className="mx-auto h-9 w-9 text-brand"/><h3 className="mt-3 font-semibold">{items.length?"No hay proyectos en esta categoría":"Tus videos aparecerán aquí"}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{items.length?"Prueba otro filtro para consultar el resto de tu biblioteca.":"Puedes empezar con una ilustración, un manga o una canción de Sonora."}</p>
        {!items.length && <Link href="/videos" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"><Clapperboard className="h-4 w-4"/>Abrir el estudio de video</Link>}
      </div>}
      {filtered.length>0 && <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((video) => {
          const active = video.status==="pending" || video.status==="running";
          return <Card key={video.id} className="min-w-0 space-y-4">
            <div className="flex items-start gap-3">
              <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                video.ready?"bg-ok/10 text-ok":video.status==="failed"?"bg-bad/10 text-bad":"bg-brand/10 text-brand")}
              >{video.ready?<CheckCircle2 className="h-5 w-5"/>:video.status==="failed"?<XCircle className="h-5 w-5"/>:active?<Loader2 className="h-5 w-5"/>:<Film className="h-5 w-5"/>}</span>
              <div className="min-w-0 flex-1"><h3 className="truncate font-semibold" title={video.title}>{video.title}</h3>
                <p className="mt-1 text-xs text-muted">{video.mode==="manga"?"Manga":"Imágenes"} · {video.aspect} · {fmtDate(video.createdAt)}</p></div>
            </div>
            {video.ready ? <video controls playsInline preload="metadata" src={`/api/videos/${video.id}/file`}
              className="aspect-video w-full rounded-xl bg-black" aria-label={`Reproducir ${video.title}`}/> :
              <div className="flex aspect-video items-center justify-center rounded-xl border border-line bg-surface-2">
                <div className="text-center"><Clapperboard className="mx-auto h-9 w-9 text-muted"/><p className="mt-2 text-xs font-semibold text-muted">{video.stage}</p></div>
              </div>}
            {active && <div className="space-y-1.5"><div className="h-2 overflow-hidden rounded-full bg-surface-2">
              {video.progress===null?<div className="shimmer h-full w-full"/>:<div className="h-full rounded-full bg-brand-gradient" style={{width:`${Math.round(video.progress*100)}%`}}/>}
              </div><p className="text-xs text-muted">{video.progress!==null?`${Math.round(video.progress*100)}% · `:""}{video.stage}</p></div>}
            {video.status==="failed" && video.error && <p className="rounded-lg border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">{video.error}</p>}
            {video.ready && <p className="text-xs text-muted">MP4 listo · {video.durationSec ? fmtTime(video.durationSec) : "Duración no disponible"}</p>}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {video.ready && <a href={`/api/videos/${video.id}/file?download=1`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand/10 px-3 text-xs font-semibold text-brand hover:bg-brand/15"><Download className="h-4 w-4"/>Descargar MP4</a>}
              {active && <Button size="sm" disabled={busy===video.id} onClick={()=>void cancel(video)}>Cancelar</Button>}
              {!active && <Button variant="ghost" size="sm" disabled={busy===video.id} onClick={()=>setConfirmId(video.id)} className="ml-auto text-bad"><Trash2 className="h-4 w-4"/>Eliminar</Button>}
            </div>
            {confirmId===video.id && <div className="rounded-xl border border-bad/25 bg-bad/5 p-3">
              <p className="text-xs font-semibold">¿Eliminar este video y sus archivos?</p>
              <div className="mt-3 flex gap-2"><Button size="sm" variant="danger" loading={busy===video.id} onClick={()=>void remove(video)}>Sí, eliminar</Button>
              <Button size="sm" onClick={()=>setConfirmId(null)}>Conservar</Button></div>
            </div>}
          </Card>;
        })}
      </div>}
    </section>
  );
}
