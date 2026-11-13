import { create } from "zustand";
import type { JobDTO, SystemStatus } from "@/lib/client/api";
import { toast } from "@/stores/toast";

interface JobsState {
  jobs: JobDTO[];
  system: SystemStatus | null;
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  refresh: () => Promise<void>;
  track: (jobs: JobDTO[]) => void;
}

let es: EventSource | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let connection = 0;

export const useJobs = create<JobsState>((set, get) => {
  const apply = (jobs: JobDTO[], system?: SystemStatus | null) => {
    const prev = new Map(get().jobs.map((j) => [j.id, j.status]));
    for (const j of jobs) {
      const before = prev.get(j.id);
      if (before && before !== j.status) {
        if (j.status === "completed") {
          toast.success(`«${j.title || "Tu canción"}» está lista`);
          window.dispatchEvent(new CustomEvent("songs:changed"));
        } else if (j.status === "failed") toast.error(`Falló la generación: ${j.error ?? "error desconocido"}`);
      }
    }
    set({ jobs, ...(system ? { system } : {}), connected: true });
  };
  const startPolling = (activeConnection: number) => {
    if (poll) return;
    const check = async () => {
      try {
        const [jobsRes, statusRes] = await Promise.all([fetch("/api/jobs"), fetch("/api/system/status")]);
        if (!jobsRes.ok || activeConnection !== connection) return;
        const data = (await jobsRes.json()) as { jobs: JobDTO[] };
        const system = statusRes.ok ? (await statusRes.json()) as SystemStatus : null;
        if (activeConnection === connection) apply(data.jobs, system);
      } catch {}
    };
    void check();
    poll = setInterval(check, 3000);
  };
  return {
    jobs: [],
    system: null,
    connected: false,
    track: (incoming) => {
      const ids = new Set(incoming.map((j) => j.id));
      set({ jobs: [...incoming, ...get().jobs.filter((j) => !ids.has(j.id))] });
    },
    refresh: async () => {
      const activeConnection = connection;
      const r = await fetch("/api/jobs");
      if (r.ok) {
        const data = (await r.json()) as { jobs: JobDTO[] };
        if (activeConnection === connection) apply(data.jobs);
      }
    },
    connect: () => {
      if (es || poll || typeof window === "undefined") return;
      const activeConnection = ++connection;
      if (typeof EventSource === "undefined") {
        startPolling(activeConnection);
        return;
      }
      es = new EventSource("/api/jobs/stream");
      es.addEventListener("state", (e) => {
        if (activeConnection !== connection) return;
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        const d = JSON.parse((e as MessageEvent).data) as { jobs: JobDTO[]; system: SystemStatus | null };
        apply(d.jobs, d.system);
      });
      es.onerror = () => {
        if (activeConnection !== connection) return;
        set({ connected: false });
        startPolling(activeConnection);
      };
    },
    disconnect: () => {
      connection++;
      es?.close();
      es = null;
      if (poll) clearInterval(poll);
      poll = null;
      set({ jobs: [], system: null, connected: false });
    },
  };
});
