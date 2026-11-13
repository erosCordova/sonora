"use client";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Play, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, cx } from "@/components/ui";
import { api, fmtTime, type JobDTO, type SongDTO } from "@/lib/client/api";
import { useJobs } from "@/stores/jobs";
import { usePlayer } from "@/stores/player";
import { toast } from "@/stores/toast";

const KIND: Record<string, string> = { generate: "Generación", cover: "Reestilizado", repaint: "Regeneración" };

function Elapsed({ from, to }: { from: string; to?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  const end = to ? new Date(to).getTime() : now;
  return <>{fmtTime(Math.max(0, (end - new Date(from).getTime()) / 1000))}</>;
}

export function JobRow({ job }: { job: JobDTO }) {
  const system = useJobs((s) => s.system);
  const refresh = useJobs((s) => s.refresh);
  const active = job.status === "pending" || job.status === "running";

  async function cancel() {
    try {
      await api(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function play() {
    if (!job.songId) return;
    try {
      const { song } = await api<{ song: SongDTO }>(`/api/songs/${job.songId}`);
      usePlayer.getState().playQueue([song]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {job.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-ok" /> : job.status === "failed" ? <XCircle className="h-5 w-5 text-bad" /> : job.status === "cancelled" ? <XCircle className="h-5 w-5 text-muted" /> : job.status === "running" ? <Loader2 className="h-5 w-5 animate-spin text-brand" /> : <Clock className="h-5 w-5 text-warn" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <p className="truncate font-semibold">{job.title || "Canción nueva"}</p>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{KIND[job.kind] ?? job.kind}</span>
          </div>
          <p className="text-sm text-muted">
            {job.status === "pending" ? "En cola" : job.status === "running" ? job.stage : job.status === "completed" ? "Completada" : job.status === "cancelled" ? "Cancelada" : "Fallida"}
            {" · "}
            <span className="tabular-nums"><Elapsed from={job.startedAt ?? job.createdAt} to={job.finishedAt} /></span>
            {job.attempts > 1 && active ? ` · intento ${job.attempts}` : ""}
          </p>
          {job.status === "running" && (
            <div className="mt-2.5">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress !== null ? Math.round(job.progress * 100) : undefined}>
                {job.progress !== null ? (
                  <div className="h-full rounded-full bg-brand-gradient transition-all duration-500" style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
                ) : (
                  <div className="shimmer h-full w-full" />
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {job.progress !== null ? `${Math.round(job.progress * 100)} % · reportado por el motor` : "El motor aún no ha reportado un porcentaje; se muestra la etapa real."}
              </p>
            </div>
          )}
          {job.status === "pending" && system && !system.workerOnline && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              No hay un worker musical conectado. Esta tarea no avanzará hasta instalar y activar ACE-Step en una máquina compatible; puedes cancelarla.
            </p>
          )}
          {job.status === "pending" && job.error && <p className="mt-2 text-xs text-warn">Último error: {job.error}</p>}
          {job.status === "failed" && job.error && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-bad/10 px-2.5 py-1.5 text-xs text-bad">{job.error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {active && <Button size="sm" variant="ghost" onClick={cancel}>Cancelar</Button>}
          {job.status === "completed" && job.songId && <Button size="sm" variant="primary" onClick={play}><Play className="h-3.5 w-3.5" />Escuchar</Button>}
        </div>
      </div>
    </li>
  );
}

export function JobsList({ filter }: { filter?: (j: JobDTO) => boolean }) {
  const jobs = useJobs((s) => s.jobs);
  const list = filter ? jobs.filter(filter) : jobs;
  if (!list.length) return null;
  return <ul className="space-y-3">{list.map((j) => <JobRow key={j.id} job={j} />)}</ul>;
}
