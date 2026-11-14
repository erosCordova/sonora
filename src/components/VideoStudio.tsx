"use client";

import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Clapperboard, Clock3,
  Download, FileArchive, FileImage, FileText, Film, Headphones, ImagePlus,
  Loader2, Mic2, RefreshCw, ShieldCheck, Sparkles, Trash2, UploadCloud,
  Volume2, WandSparkles, XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback, useEffect, useRef, useState,
  type DragEvent, type FormEvent,
} from "react";
import { Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { api, fmtTime, type SongDTO } from "@/lib/client/api";
import { toast } from "@/stores/toast";

type Mode = "imagenes" | "manga";
type Aspect = "16:9" | "9:16";
type Step = 1 | 2 | 3;
type Project = {
  id: string; title: string; mode: string; aspect: string;
  status: string; stage: string; error: string | null;
  progress: number | null; ready: boolean; createdAt: string; durationSec: number | null;
};
type MediaAsset = { id: string; file: File; url: string | null };
type VideoResponse = {
  videos: Project[];
  motor?: { online: boolean; pending: number; running: number };
};
const visuals = /\.(png|jpe?g|webp|cbz|zip|pdf)$/i;
const audioExt = /\.(mp3|wav|m4a|flac)$/i;
const MiB = 1024 * 1024;
const MAX_FILE = 16 * MiB;
const MAX_BUNDLE = 24 * MiB;
const MB = (n: number) => (n / MiB).toFixed(1);

function AssetIcon({file}: {file: File}) {
  if (/\.pdf$/i.test(file.name)) return <FileText className="h-5 w-5"/>;
  if (/\.(cbz|zip)$/i.test(file.name)) return <FileArchive className="h-5 w-5"/>;
  return <FileImage className="h-5 w-5"/>;
}

export function VideoStudio() {
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("imagenes");
  const [title, setTitle] = useState("Mi nuevo video");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [duration, setDuration] = useState(15);
  const [script, setScript] = useState("");
  const [narration, setNarration] = useState(false);
  const [splitPanels, setSplitPanels] = useState(false);
  const [readingOrder, setReadingOrder] = useState<"rtl" | "ltr">("rtl");
  const [multiVoice, setMultiVoice] = useState(true);
  const [sceneSync, setSceneSync] = useState<"uniform" | "music">("music");
  const [subtitles, setSubtitles] = useState(true);
  const [songId, setSongId] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [songs, setSongs] = useState<SongDTO[]>([]);
  const [videos, setVideos] = useState<Project[]>([]);
  const [motor, setMotor] = useState<VideoResponse["motor"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const urls = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await api<VideoResponse>("/api/videos");
      setVideos(data.videos);
      setMotor(data.motor ?? null);
    } catch {
      setMotor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("songId");
    const initial = window.setTimeout(() => {
      if (id && /^[0-9a-f-]{36}$/i.test(id)) setSongId(id);
      void load();
    }, 0);
    void api<{songs: SongDTO[]}>("/api/songs?scope=mine&limit=80")
      .then((data) => setSongs(data.songs)).catch(() => {});
    const interval = window.setInterval(() => void load(), 7000);
    const created = urls.current;
    return () => {
      window.clearTimeout(initial); window.clearInterval(interval);
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, [load]);

  const chosenSong = songs.find((song) => song.id === songId);
  const totalSize = assets.reduce((sum, asset) => sum + asset.file.size, audio?.size ?? 0);
  const canProcess = motor?.online === true;
  const hasAudio = Boolean(songId || audio || narration);
  const firstPreview = assets.find((asset) => asset.url)?.url ?? null;
  const current = videos.slice(0, 4);

  function addFiles(picked: File[]) {
    if (!picked.length) return;
    const permitted = picked.filter((file) => visuals.test(file.name));
    if (picked.length !== permitted.length) {
      toast.error("Solo se admiten PNG, JPG, WEBP, CBZ, ZIP o PDF para las escenas.");
      return;
    }
    if (picked.some((file) => file.size === 0 || file.size > MAX_FILE)) {
      toast.error("Cada archivo debe ser menor de 16 MB y no estar vacío.");
      return;
    }
    if (assets.length + picked.length > 12) {
      toast.error("Máximo 12 archivos de escenas; puedes agrupar páginas en un CBZ/ZIP.");
      return;
    }
    if (totalSize + picked.reduce((sum, file) => sum + file.size, 0) > MAX_BUNDLE) {
      toast.error("El proyecto supera 24 MB. Reduce las imágenes o el audio.");
      return;
    }
    const created = picked.map((file) => {
      const preview = /\.(png|jpe?g|webp)$/i.test(file.name) ? URL.createObjectURL(file) : null;
      if (preview) urls.current.add(preview);
      return { id: crypto.randomUUID(), file, url: preview };
    });
    setAssets((old) => [...old, ...created]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }
  function removeAsset(id: string) {
    const target = assets.find((asset) => asset.id === id);
    if (target?.url) {
      URL.revokeObjectURL(target.url);
      urls.current.delete(target.url);
    }
    setAssets((old) => old.filter((asset) => asset.id !== id));
  }
  function moveAsset(index: number, direction: -1 | 1) {
    const next = [...assets];
    const to = index + direction;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setAssets(next);
  }
  function selectAudio(file: File | null) {
    if (file && (!audioExt.test(file.name) || file.size === 0 || file.size > MAX_FILE)) {
      toast.error("Selecciona un MP3, WAV, M4A o FLAC de hasta 16 MB.");
      if (audioRef.current) audioRef.current.value = "";
      return;
    }
    if (file && assets.reduce((sum, item) => sum + item.file.size, 0) + file.size > MAX_BUNDLE) {
      toast.error("Las imágenes y el audio deben sumar 24 MB como máximo.");
      if (audioRef.current) audioRef.current.value = "";
      return;
    }
    setAudio(file);
    if (file) setSongId("");
  }
  function nextStep() {
    if (step === 1) {
      if (!assets.length) return toast.error("Añade al menos una imagen o un capítulo de manga.");
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!hasAudio) return toast.error("Selecciona una canción, un audio o activa la narración.");
      if (narration && !script.trim()) return toast.error("Escribe el texto que se va a narrar.");
      setStep(3);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== 3) return;
    if (!assets.length || !hasAudio || (narration && !script.trim())) {
      toast.error("Revisa las imágenes y el audio antes de crear el video.");
      return;
    }
    if (title.trim().length < 2) return toast.error("Escribe un título de al menos dos caracteres.");
    if (!canProcess) return toast.error("Conecta el motor de video en ComfyUI antes de generar.");
    setBusy(true);
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        title: title.trim(), mode, aspect, duration: String(duration),
        script, narration: String(narration), songId,
        splitPanels: String(mode==="manga" && splitPanels), readingOrder,
        multiVoice: String(narration && multiVoice), sceneSync, subtitles: String(subtitles),
      })) form.set(key, value);
      for (const item of assets) form.append("files", item.file, item.file.name);
      if (audio) form.append("files", audio, audio.name);
      const response = await fetch("/api/videos", {method:"POST", body: form});
      const data = await response.json() as {error?:string};
      if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
      toast.success("Proyecto guardado y enviado al motor local.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-7">
      <section className="studio-hero relative overflow-hidden rounded-[28px] px-6 py-7 sm:px-9 sm:py-9">
        <div className="studio-mosaic pointer-events-none absolute inset-y-0 right-0 hidden w-2/5 opacity-30 sm:block" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white/95">
              <Sparkles className="h-3.5 w-3.5"/> SONORA VIDEO STUDIO
            </p>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">Dale vida a tus historias.</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/85">
              Crea videoclips y transforma tus fotografías, ilustraciones o capítulos de manga en videos con narración, música y movimiento de cámara.
            </p>
          </div>
          <div className="relative grid h-20 w-20 shrink-0 place-items-center rounded-[26px] border border-white/25 bg-white/10 shadow-2xl sm:h-24 sm:w-24">
            <Clapperboard className="h-9 w-9 text-white sm:h-11 sm:w-11"/>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2 text-[11px] font-semibold text-white/90">
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">MP4 · horizontal / vertical</span>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">Hasta 60 segundos</span>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">Procesamiento local</span>
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20.5rem]">
        <form onSubmit={submit} className="min-w-0 space-y-5">
          <Card className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="font-display text-lg font-bold">Nuevo proyecto</h2><p className="mt-1 text-xs text-muted">Organiza tu material en tres pasos.</p></div>
              <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted">Paso {step} de 3</span>
            </div>
            <ol className="grid grid-cols-3 gap-2" aria-label="Pasos de creación">
              {(["Escenas", "Audio", "Exportar"] as const).map((label, i) => {
                const n = (i + 1) as Step;
                return <li key={label}>
                  <button type="button" disabled={n > step} onClick={() => {if(n < step) setStep(n);}}
                    aria-current={n===step ? "step" : undefined}
                    className={cx("flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors sm:px-3",
                      n===step ? "bg-brand/10 text-brand" : n<step ? "text-fg hover:bg-surface-2" : "text-muted opacity-65")}
                  >
                    <span className="studio-step shrink-0" data-active={n===step}>{n < step ? <CheckCircle2 className="h-4 w-4"/> : n}</span>
                    <span className="text-xs font-semibold sm:text-sm">{label}</span>
                  </button>
                </li>;
              })}
            </ol>
          </Card>

          {step === 1 && <Card className="space-y-5">
            <div><h2 className="font-display text-lg font-bold">1. Selecciona el origen</h2>
              <p className="mt-1 text-sm text-muted">Elige cómo se interpretarán las imágenes en tu video.</p></div>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de proyecto">
              {([
                {id:"imagenes" as const, icon:ImagePlus, label:"Imágenes a video", desc:"Fotografías, ilustraciones y portadas con movimiento de cámara."},
                {id:"manga" as const, icon:Film, label:"Manga a video", desc:"Páginas, viñetas y capítulos CBZ, ZIP o PDF."},
              ]).map(({id,icon:Icon,label,desc}) => <button type="button" role="radio" aria-checked={mode===id} key={id}
                onClick={()=>setMode(id)} className={cx("rounded-2xl border p-4 text-left transition-colors",
                  mode===id ? "border-brand bg-brand/10 ring-1 ring-brand/25" : "border-line bg-surface hover:border-brand/40 hover:bg-surface-2")}
              >
                <Icon className={cx("h-6 w-6",mode===id?"text-brand":"text-muted")}/>
                <span className="mt-3 block text-sm font-bold">{label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">{desc}</span>
              </button>)}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted" htmlFor="video-assets">Archivos para las escenas</label>
              <div data-dragging={dragging} onDragEnter={(e)=>{e.preventDefault();setDragging(true);}}
                onDragOver={(e)=>e.preventDefault()} onDragLeave={(e)=>{e.preventDefault();setDragging(false);}}
                onDrop={onDrop} className="studio-upload rounded-2xl p-6 text-center sm:p-9">
                <UploadCloud className="mx-auto h-9 w-9 text-brand"/>
                <p className="mt-3 font-semibold">Arrastra tus archivos aquí</p>
                <p className="mt-1 text-xs text-muted">PNG, JPG, WEBP, CBZ, ZIP y PDF · hasta 12 archivos</p>
                <input ref={inputRef} id="video-assets" className="sr-only" type="file" multiple
                  accept=".png,.jpg,.jpeg,.webp,.cbz,.zip,.pdf" onChange={(e)=>{
                    addFiles(Array.from(e.target.files ?? [])); e.target.value="";
                  }}/>
                <Button type="button" size="sm" className="mt-4" onClick={()=>inputRef.current?.click()}>
                  <ImagePlus className="h-4 w-4"/>Seleccionar archivos
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                Máximo 16 MB por archivo y 24 MB por proyecto. Las escenas se montan en el orden mostrado.
                {mode==="manga" && " Para PDF, el motor local requiere PyMuPDF. El texto del manga se introduce manualmente."}
              </p>
            </div>
            {mode === "manga" && <div className="space-y-3 rounded-2xl border border-line bg-surface-2/55 p-4">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" checked={splitPanels} onChange={(e)=>setSplitPanels(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--brand)]"/>
                <span><span className="block font-semibold">Detectar y separar viñetas</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">Busca divisiones blancas entre las viñetas. Funciona mejor con páginas bien delimitadas; si no detecta una división, conserva la página completa.</span></span>
              </label>
              {splitPanels && <Field label="Orden de lectura">
                <Select value={readingOrder} onChange={(e)=>setReadingOrder(e.target.value as "rtl"|"ltr")}>
                  <option value="rtl">Manga japonés · derecha a izquierda</option>
                  <option value="ltr">Cómic occidental · izquierda a derecha</option>
                </Select>
              </Field>}
            </div>}
            {assets.length > 0 && <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold">Orden de las escenas <span className="font-normal text-muted">({assets.length})</span></p>
                <p className="text-xs text-muted">{MB(totalSize)} / 24 MB</p>
              </div>
              <ul className="space-y-2">
                {assets.map((item,index)=><li key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-2/55 p-2.5">
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-muted">{index+1}</span>
                  {item.url ? <div className="h-12 w-14 shrink-0 rounded-lg bg-cover bg-center" role="img" aria-label={item.file.name} style={{backgroundImage:`url(${item.url})`}}/>
                    : <div className="grid h-12 w-14 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><AssetIcon file={item.file}/></div>}
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={item.file.name}>{item.file.name}</p>
                  <p className="text-[11px] text-muted">{MB(item.file.size)} MB</p></div>
                  <button type="button" aria-label={`Subir escena ${index+1}`} disabled={index===0} onClick={()=>moveAsset(index,-1)} className="rounded-lg p-1.5 text-muted hover:bg-surface disabled:opacity-30"><ArrowUp className="h-4 w-4"/></button>
                  <button type="button" aria-label={`Bajar escena ${index+1}`} disabled={index===assets.length-1} onClick={()=>moveAsset(index,1)} className="rounded-lg p-1.5 text-muted hover:bg-surface disabled:opacity-30"><ArrowDown className="h-4 w-4"/></button>
                  <button type="button" aria-label={`Eliminar escena ${index+1}`} onClick={()=>removeAsset(item.id)} className="rounded-lg p-1.5 text-bad hover:bg-bad/10"><Trash2 className="h-4 w-4"/></button>
                </li>)}
              </ul>
            </div>}
            <div className="flex justify-end border-t border-line pt-4">
              <Button type="button" variant="primary" size="lg" onClick={nextStep} disabled={!assets.length}>
                Continuar con el audio <ArrowRight className="h-4 w-4"/>
              </Button>
            </div>
          </Card>}

          {step === 2 && <Card className="space-y-5">
            <div><h2 className="font-display text-lg font-bold">2. Música, voz y diálogos</h2>
              <p className="mt-1 text-sm text-muted">Selecciona la banda sonora y añade narración si la necesitas.</p></div>
            <Field label="Usar una canción de Sonora" hint="opcional">
              <Select value={songId} onChange={(e)=>{
                setSongId(e.target.value); if(e.target.value){setAudio(null);if(audioRef.current)audioRef.current.value="";}
              }}>
                <option value="">No usar una canción de mi biblioteca</option>
                {songs.map((s)=><option key={s.id} value={s.id}>{s.title} · {fmtTime(s.durationSec)}</option>)}
              </Select>
            </Field>
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted"><div className="h-px flex-1 bg-line"/>o utiliza audio propio<div className="h-px flex-1 bg-line"/></div>
            <Field label="Archivo de audio" hint="MP3, WAV, M4A, FLAC · hasta 16 MB">
              <Input ref={audioRef} type="file" accept=".mp3,.wav,.m4a,.flac" onChange={(e)=>selectAudio(e.target.files?.[0] ?? null)}/>
            </Field>
            {(audio || chosenSong) && <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand/5 p-3">
              <Headphones className="h-5 w-5 shrink-0 text-brand"/>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{audio?.name ?? chosenSong?.title}</span>
              {audio && <span className="shrink-0 text-[11px] text-muted">{MB(audio.size)} MB</span>}
            </div>}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-2/60 p-4">
              <input type="checkbox" checked={narration} onChange={(e)=>setNarration(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand)]"/>
              <span className="flex-1"><span className="flex items-center gap-2 text-sm font-bold"><Mic2 className="h-4 w-4 text-brand"/>Añadir narración</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">Genera una voz de narrador con el motor local de Windows; se mezcla con el audio si seleccionaste una pista.</span></span>
            </label>
            {narration && mode === "manga" && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand/20 bg-brand/5 p-3">
              <input type="checkbox" checked={multiVoice} onChange={(e)=>setMultiVoice(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--brand)]"/>
              <span><span className="block text-sm font-bold">Voces diferentes para personajes</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted">Escribe cada línea como «Narrador: ...», «Personaje: ...». Sonora asigna voces y velocidades diferentes según las voces disponibles en Windows, sin clonarlas.</span></span>
            </label>}
            {narration && <Field label={mode==="manga"?"Diálogos por personaje":"Guion de narración"} hint={`${script.length}/3000`}>
              <Textarea rows={7} maxLength={3000} value={script} onChange={(e)=>setScript(e.target.value)}
                placeholder={mode==="manga"
                  ? "Narrador: Un nuevo día comienza.\nHéroe: Debemos salir de aquí.\nCompañera: ¡Voy contigo!"
                  : "Narrador: En una ciudad lejana comienza una nueva aventura..."}/>
            </Field>}
            {mode === "manga" && <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand"/>
              Sonora puede separar viñetas y asignar distintas voces a las líneas del guion. La lectura automática de los globos y la identificación de personajes todavía no están disponibles; escribe o corrige los diálogos antes de generar.
            </div>}
            <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-4">
              <Button type="button" onClick={()=>setStep(1)}><ArrowLeft className="h-4 w-4"/>Volver</Button>
              <Button type="button" variant="primary" size="lg" onClick={nextStep} disabled={!hasAudio || (narration && !script.trim())}>
                Configurar video <ArrowRight className="h-4 w-4"/>
              </Button>
            </div>
          </Card>}

          {step === 3 && <Card className="space-y-5">
            <div><h2 className="font-display text-lg font-bold">3. Ajustes de exportación</h2>
              <p className="mt-1 text-sm text-muted">Confirma los datos antes de enviar el montaje a tu computadora.</p></div>
            <Field label="Título del proyecto"><Input value={title} maxLength={120} minLength={2} required onChange={(e)=>setTitle(e.target.value)}/></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Formato"><Select value={aspect} onChange={(e)=>setAspect(e.target.value as Aspect)}>
                <option value="16:9">16:9 · Horizontal</option><option value="9:16">9:16 · Vertical</option>
              </Select></Field>
              <Field label="Duración"><Select value={duration} onChange={(e)=>setDuration(Number(e.target.value))}>
                <option value={15}>15 segundos</option><option value={30}>30 segundos</option><option value={60}>60 segundos</option>
              </Select></Field>
            </div>
            <div className="space-y-3 rounded-2xl border border-line bg-surface-2/55 p-4">
              <h3 className="text-sm font-bold">Montaje audiovisual</h3>
              <Field label="Cambio de escenas">
                <Select value={sceneSync} onChange={(e)=>setSceneSync(e.target.value as "uniform"|"music")}>
                  <option value="uniform">Duración uniforme entre escenas</option>
                  <option value="music" disabled={!audio&&!songId}>Seguir cambios de intensidad de la música</option>
                </Select>
              </Field>
              <p className="text-xs leading-relaxed text-muted">El ajuste musical busca acentos y transitorios para cambiar de escena cerca del ritmo. No analiza ni interpreta la letra automáticamente.</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={subtitles} onChange={(e)=>setSubtitles(e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand)]"/>
                Mostrar líneas del guion sobre el video
              </label>
            </div>
            <div className="grid gap-4 rounded-2xl border border-line bg-surface-2/55 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className={cx("relative flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-[#14203b]",aspect==="9:16"?"aspect-[9/16] max-h-56 justify-self-center":"aspect-video")}
                role={firstPreview?"img":undefined} aria-label={firstPreview?"Vista previa de la primera imagen":undefined}>
                {firstPreview ? <div className="absolute inset-0 bg-cover bg-center" style={{backgroundImage:`url(${firstPreview})`}}/> : <FileImage className="h-10 w-10 text-white/55"/>}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-xs font-semibold text-white">Vista previa de la primera escena</div>
              </div>
              <div className="self-center space-y-3 text-sm">
                <p className="font-bold">{title.trim() || "Sin título"}</p>
                <p className="flex items-center gap-2 text-muted"><FileImage className="h-4 w-4 text-brand"/>{assets.length} archivo(s) visuales</p>
                <p className="flex items-center gap-2 text-muted"><Clock3 className="h-4 w-4 text-brand"/>{duration} segundos · {aspect}</p>
                <p className="flex items-center gap-2 text-muted"><Volume2 className="h-4 w-4 text-brand"/>{chosenSong?.title ?? audio?.name ?? "Solo narración"}</p>
                {narration && <p className="flex items-center gap-2 text-muted"><Mic2 className="h-4 w-4 text-brand"/>Narración local activada</p>}
              </div>
            </div>
            <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed text-muted">
              Se montarán imágenes y viñetas con movimientos de cámara, voces locales y cortes audiovisuales. La animación corporal por difusión, el reconocimiento OCR y la sincronización labial no están disponibles todavía.
            </p>
            <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-4">
              <Button type="button" onClick={()=>setStep(2)}><ArrowLeft className="h-4 w-4"/>Volver</Button>
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!canProcess}>
                <WandSparkles className="h-4 w-4"/>Crear MP4
              </Button>
            </div>
            {!canProcess && <p className="text-xs font-semibold text-warn">El motor de video debe estar conectado para poder generar el MP4.</p>}
          </Card>}
        </form>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3"><h2 className="font-display font-bold">Motor de video</h2>
              <button type="button" aria-label="Actualizar estado del motor" onClick={()=>void load()} className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-fg"><RefreshCw className="h-4 w-4"/></button></div>
            <div className={cx("flex items-start gap-3 rounded-xl border p-3.5",
              canProcess ? "border-ok/30 bg-ok/5" : "border-line bg-surface-2/55")}>
              <span className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full",canProcess?"bg-ok":"bg-warn")}/>
              <div className="space-y-1"><p className="text-sm font-bold">{loading?"Comprobando conexión":canProcess?"Motor local disponible":"Motor de video desconectado"}</p>
                <p className="text-xs leading-relaxed text-muted">{canProcess?"Tu computadora puede recibir encargos audiovisuales.":"Actualiza el complemento Sonora en ComfyUI y conecta el motor local."}</p></div>
            </div>
            {motor && <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-xl bg-surface-2 p-3"><span className="block text-lg font-bold text-fg">{motor.pending}</span><span className="text-muted">En cola</span></div>
              <div className="rounded-xl bg-surface-2 p-3"><span className="block text-lg font-bold text-fg">{motor.running}</span><span className="text-muted">En proceso</span></div>
            </div>}
            {!canProcess && <a target="_blank" rel="noreferrer" href="https://github.com/erosCordova/sonora/blob/main/docs/SONORA_VIDEO_MVP.md" className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline underline-offset-2">Ver conexión local <ArrowRight className="h-3.5 w-3.5"/></a>}
          </Card>
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-2"><h2 className="font-display font-bold">Proyectos recientes</h2><span className="text-xs text-muted">{videos.length}</span></div>
            {loading && <p className="text-xs text-muted">Cargando proyectos...</p>}
            {!loading && current.length===0 && <div className="rounded-xl border border-dashed border-line px-4 py-7 text-center"><Film className="mx-auto h-7 w-7 text-muted"/><p className="mt-2 text-xs text-muted">Aún no tienes videos.</p></div>}
            {current.map((video)=><article key={video.id} className="space-y-2 rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start gap-2"><span className={cx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",video.ready?"bg-ok/10 text-ok":video.status==="failed"?"bg-bad/10 text-bad":"bg-brand/10 text-brand")}
              >{video.ready?<CheckCircle2 className="h-4 w-4"/>:video.status==="failed"?<XCircle className="h-4 w-4"/>:<Loader2 className="h-4 w-4"/>}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold" title={video.title}>{video.title}</p><p className="text-[11px] text-muted">{video.stage}</p></div>
              </div>
              {video.status==="failed"&&video.error&&<p className="break-words text-xs text-bad">{video.error}</p>}
              {video.status==="running"&&video.progress!==null&&<div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand-gradient" style={{width:`${Math.max(0,Math.min(100,video.progress*100))}%`}}/></div>}
              {video.ready&&<div className="space-y-2"><video controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-black" src={`/api/videos/${video.id}/file`}/>
                <a className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline" href={`/api/videos/${video.id}/file?download=1`}><Download className="h-3.5 w-3.5"/>Descargar MP4</a></div>}
            </article>)}
            <Link className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline" href="/library">Ver mi biblioteca completa <ArrowRight className="h-3.5 w-3.5"/></Link>
          </Card>
          <p className="px-1 text-xs leading-relaxed text-muted">Tus archivos son privados. Los videos ocupan espacio de almacenamiento en Render y requieren que tu equipo siga conectado durante el montaje.</p>
        </aside>
      </div>
    </div>
  );
}
