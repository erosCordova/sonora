"use client";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ListMusic,
  Loader2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  FastForward,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Cover } from "@/components/Cover";
import { cx } from "@/components/ui";
import { api, fmtTime } from "@/lib/client/api";
import { languageLabel } from "@/lib/music-options";
import { usePlayer } from "@/stores/player";
import { toast } from "@/stores/toast";

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function Player() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const switching = useRef(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"lyrics" | "queue">("lyrics");

  const song = usePlayer((s) => s.queue[s.index] ?? null);
  const hasSong = Boolean(song);
  const songId = song?.id;
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const expanded = usePlayer((s) => s.expanded);
  const seekRequest = usePlayer((s) => s.seekRequest);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const st = usePlayer.getState;

  // Crear wavesurfer una vez que el contenedor existe
  useEffect(() => {
    if (!hasSong || wsRef.current || !waveRef.current || !audioRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      media: audioRef.current,
      height: 38,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 0,
      normalize: true,
      dragToSeek: true,
      waveColor: cssVar("--line"),
      progressColor: cssVar("--brand"),
    });
    ws.on("error", () => {});
    wsRef.current = ws;
    const obs = new MutationObserver(() => ws.setOptions({ waveColor: cssVar("--line"), progressColor: cssVar("--brand") }));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [hasSong]);

  // Cargar pista mediante URL temporal firmada
  useEffect(() => {
    const audio = audioRef.current;
    if (!songId || !audio) return;
    let cancelled = false;
    switching.current = true;
    setLoading(true);
    (async () => {
      try {
        const { url } = await api<{ url: string }>(`/api/songs/${songId}/url`);
        if (cancelled) return;
        if (wsRef.current) await wsRef.current.load(url).catch(() => {});
        else audio.src = url;
        if (!audio.src.includes(songId)) audio.src = url;
      } catch (e) {
        if (!cancelled) {
          toast.error(`No se pudo cargar el audio: ${(e as Error).message}`);
          st().setPlaying(false);
          setLoading(false);
          switching.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songId, st]);

  // Estado de reproducción
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !songId) return;
    if (playing) a.play().catch(() => {});
    else a.pause();
  }, [playing, songId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (seekRequest && audioRef.current && Number.isFinite(audioRef.current.duration)) audioRef.current.currentTime = seekRequest.t;
  }, [seekRequest]);

  // Media Session (controles del sistema / pantalla de bloqueo)
  useEffect(() => {
    if (!song || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: "Sonora", album: song.genre || "IA" });
    navigator.mediaSession.setActionHandler("play", () => st().setPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => st().setPlaying(false));
    navigator.mediaSession.setActionHandler("nexttrack", () => st().next());
    navigator.mediaSession.setActionHandler("previoustrack", () => st().prev());
  }, [song, st]);

  const dur = duration || song?.durationSec || 0;

  return (
    <>
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={(e) => st().setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          st().setTime(0, Number.isFinite(d) ? d : 0);
        }}
        onCanPlay={(e) => {
          switching.current = false;
          setLoading(false);
          if (usePlayer.getState().playing) e.currentTarget.play().catch(() => {});
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false);
          st().setPlaying(true);
        }}
        onPause={(e) => {
          if (!switching.current && !e.currentTarget.ended) st().setPlaying(false);
        }}
        onEnded={() => st().next(true)}
        onError={() => {
          if (songId) toast.error("No se pudo reproducir el archivo de audio");
          setLoading(false);
          switching.current = false;
          st().setPlaying(false);
        }}
      />

      {hasSong && song && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-xl lg:left-64">
          <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)] lg:px-6">
            <button onClick={() => st().setExpanded(true)} className="flex min-w-0 items-center gap-3 text-left" aria-label="Abrir reproductor">
              <Cover seed={song.coverSeed} className="h-12 w-12 shrink-0 rounded-lg shadow-md" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{song.title}</span>
                <span className="block truncate text-xs text-muted">{[song.genre, song.subgenre].filter(Boolean).join(" · ") || "Música IA"}</span>
              </span>
            </button>
            <div className="flex items-center gap-1 lg:hidden">
              <IconBtn label="Anterior" onClick={() => st().prev()}><SkipBack className="h-[18px] w-[18px]" /></IconBtn>
              <PlayBtn loading={loading} playing={playing} />
              <IconBtn label="Siguiente" onClick={() => st().next()}><SkipForward className="h-[18px] w-[18px]" /></IconBtn>
            </div>
            <div className="order-last col-span-2 min-w-0 lg:order-none lg:col-span-1">
              <div className="hidden lg:block"><Controls loading={loading} /></div>
              <div className="flex items-center gap-2">
                <span className="w-9 text-right text-[11px] tabular-nums text-muted">{fmtTime(currentTime)}</span>
                <div ref={waveRef} className="min-w-0 flex-1" />
                <span className="w-9 text-[11px] tabular-nums text-muted">{fmtTime(dur)}</span>
              </div>
            </div>
            <div className="hidden items-center justify-end gap-2 lg:flex">
              <IconBtn label="Letra" onClick={() => { setTab("lyrics"); st().setExpanded(true); }}><Mic2 className="h-4 w-4" /></IconBtn>
              <IconBtn label="Cola" onClick={() => { setTab("queue"); st().setExpanded(true); }}><ListMusic className="h-4 w-4" /></IconBtn>
              <VolumeControl />
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {expanded && song && (
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-bg"
          >
            <div className="pointer-events-none absolute inset-0 opacity-40 blur-3xl"><Cover seed={song.coverSeed} className="h-full w-full" /></div>
            <div className="relative flex items-center justify-between px-4 py-3">
              <IconBtn label="Cerrar" onClick={() => st().setExpanded(false)}><ChevronDown className="h-5 w-5" /></IconBtn>
              <span className="text-xs font-semibold uppercase tracking-widest text-muted">Reproduciendo</span>
              <span className="w-9" />
            </div>
            <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6 lg:flex-row lg:items-start lg:gap-10 lg:px-10">
              <div className="mx-auto w-full max-w-xs shrink-0 lg:max-w-sm">
                <Cover seed={song.coverSeed} className="aspect-square w-full rounded-3xl shadow-2xl" />
                <h2 className="mt-5 font-display text-2xl font-bold">{song.title}</h2>
                <p className="text-sm text-muted">{[song.genre, song.subgenre, song.language && languageLabel(song.language)].filter(Boolean).join(" · ")}</p>
                <div className="mt-5">
                  <input
                    type="range"
                    min={0}
                    max={dur || 1}
                    step={0.1}
                    value={Math.min(currentTime, dur || 1)}
                    onChange={(e) => st().seek(Number(e.target.value))}
                    aria-label="Posición"
                    className="w-full accent-[var(--brand)]"
                  />
                  <div className="flex justify-between text-xs tabular-nums text-muted"><span>{fmtTime(currentTime)}</span><span>{fmtTime(dur)}</span></div>
                </div>
                <div className="mt-3"><Controls big loading={loading} /></div>
                <div className="mt-4 flex items-center justify-center gap-2"><VolumeControl /></div>
              </div>
              <div className="flex min-h-[18rem] w-full min-w-0 flex-1 flex-col rounded-3xl border border-line bg-surface/80 p-4 backdrop-blur lg:max-h-[75dvh]">
                <div className="mb-3 flex gap-2">
                  <TabBtn on={tab === "lyrics"} onClick={() => setTab("lyrics")}><Mic2 className="h-4 w-4" />Letra</TabBtn>
                  <TabBtn on={tab === "queue"} onClick={() => setTab("queue")}><ListMusic className="h-4 w-4" />Cola ({queue.length})</TabBtn>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {tab === "lyrics" ? (
                    song.lyrics.trim() && song.lyrics.trim() !== "[Instrumental]" ? (
                      <pre className="whitespace-pre-wrap font-sans text-[15px] leading-7">{song.lyrics}</pre>
                    ) : (
                      <p className="py-8 text-center text-sm text-muted">Esta canción es instrumental: no tiene letra.</p>
                    )
                  ) : (
                    <ul className="space-y-1">
                      {queue.map((q, i) => (
                        <li key={q.id} className={cx("flex items-center gap-3 rounded-xl p-2", i === index ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => st().jumpTo(i)}>
                            <Cover seed={q.coverSeed} className="h-10 w-10 shrink-0 rounded-lg" />
                            <span className="min-w-0 flex-1">
                              <span className={cx("block truncate text-sm font-medium", i === index && "text-brand")}>{q.title}</span>
                              <span className="block text-xs text-muted">{fmtTime(q.durationSec)}</span>
                            </span>
                          </button>
                          <IconBtn label="Quitar de la cola" onClick={() => st().removeFromQueue(q.id)}><X className="h-4 w-4" /></IconBtn>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Controls({ big, loading }: { big?: boolean; loading: boolean }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const playing = usePlayer((s) => s.playing);
  const st = usePlayer.getState;
  return (
    <div className={cx("flex items-center justify-center", big ? "gap-3" : "gap-1")}>
      <IconBtn label="Aleatorio" active={shuffle} onClick={() => st().toggleShuffle()}><Shuffle className="h-4 w-4" /></IconBtn>
      <IconBtn label="Anterior" onClick={() => st().prev()}><SkipBack className="h-[18px] w-[18px]" /></IconBtn>
      <IconBtn label="Retroceder 10 segundos" onClick={() => st().skip(-10)}><Rewind className="h-4 w-4" /></IconBtn>
      <PlayBtn loading={loading} playing={playing} big={big} />
      <IconBtn label="Adelantar 10 segundos" onClick={() => st().skip(10)}><FastForward className="h-4 w-4" /></IconBtn>
      <IconBtn label="Siguiente" onClick={() => st().next()}><SkipForward className="h-[18px] w-[18px]" /></IconBtn>
      <IconBtn label={`Repetición: ${repeat === "off" ? "desactivada" : repeat === "all" ? "toda la cola" : "una canción"}`} active={repeat !== "off"} onClick={() => st().cycleRepeat()}>
        {repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
      </IconBtn>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition", on ? "bg-brand-gradient text-white" : "text-muted hover:bg-surface-2")}>
      {children}
    </button>
  );
}

function IconBtn({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx("grid h-9 w-9 place-items-center rounded-full transition active:scale-90", active ? "text-brand" : "text-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

function PlayBtn({ loading, playing, big }: { loading: boolean; playing: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => usePlayer.getState().toggle()}
      aria-label={playing ? "Pausar" : "Reproducir"}
      className={cx("grid place-items-center rounded-full bg-brand-gradient text-white glow transition active:scale-90", big ? "h-14 w-14" : "h-10 w-10")}
    >
      {loading && playing ? <Loader2 className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
    </button>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  return (
    <div className="flex items-center gap-1">
      <IconBtn label={muted ? "Activar sonido" : "Silenciar"} onClick={() => usePlayer.getState().toggleMute()}>
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </IconBtn>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => usePlayer.getState().setVolume(Number(e.target.value))}
        aria-label="Volumen"
        className="w-24 accent-[var(--brand)]"
      />
    </div>
  );
}
