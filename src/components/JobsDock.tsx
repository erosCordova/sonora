"use client";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { JobsList } from "@/components/JobsList";
import { cx } from "@/components/ui";
import { useJobs } from "@/stores/jobs";
import { usePlayer } from "@/stores/player";

// Indicador global: el usuario ve el progreso real aunque navegue a otra sección.
export function JobsDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeCount = useJobs((s) => s.jobs.filter((j) => j.status === "pending" || j.status === "running").length);
  const workerOnline = useJobs((s) => s.system?.workerOnline);
  const hasTrack = usePlayer((s) => s.index >= 0);
  if (activeCount === 0 || pathname.startsWith("/create")) return null;
  return (
    <div className={cx("fixed right-3 z-40 w-[min(24rem,calc(100vw-1.5rem))]", hasTrack ? "bottom-36 lg:bottom-28" : "bottom-4")}>
      {open && (
        <div className="mb-2 max-h-[50dvh] overflow-y-auto rounded-2xl bg-bg/90 p-2 shadow-2xl backdrop-blur">
          <JobsList filter={(j) => j.status === "pending" || j.status === "running"} />
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="ml-auto flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium shadow-xl">
        <Loader2 className={`h-4 w-4 text-brand ${workerOnline ? "animate-spin" : ""}`} />
        {workerOnline
          ? `${activeCount} ${activeCount === 1 ? "canción en proceso" : "canciones en proceso"}`
          : `${activeCount} ${activeCount === 1 ? "canción pendiente · sin motor" : "canciones pendientes · sin motor"}`}
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
    </div>
  );
}
