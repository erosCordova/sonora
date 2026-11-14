"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Clapperboard, FileImage, Film, Mic2, Music2, Video, Download, RefreshCw } from "lucide-react";
import { Button, Card, Field, Input, Select, Segmented, Textarea } from "@/components/ui";
import { api, fmtTime, type SongDTO } from "@/lib/client/api";
import { toast } from "@/stores/toast";

type VideoDTO = {id:string;title:string;mode:string;aspect:string;createdAt:string;durationSec:number|null;
  status:string;stage:string;error:string|null;progress:number|null;ready:boolean};

export function VideoStudio() {
  const [mode,setMode]=useState<"imagenes"|"manga">("imagenes");
  const [title,setTitle]=useState("Mi primer video");
  const [aspect,setAspect]=useState<"16:9"|"9:16">("16:9");
  const [duration,setDuration]=useState(30);
  const [script,setScript]=useState("");
  const [narration,setNarration]=useState(false);
  const [songId,setSongId]=useState("");
  const [files,setFiles]=useState<File[]>([]);
  const [audio,setAudio]=useState<File|null>(null);
  const [songs,setSongs]=useState<SongDTO[]>([]);
  const [videos,setVideos]=useState<VideoDTO[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    try {const data=await api<{videos:VideoDTO[]}>("/api/videos");setVideos(data.videos);}
    catch(e){toast.error((e as Error).message);}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    const id = new URLSearchParams(window.location.search).get("songId");
    if(id && /^[0-9a-f-]{36}$/i.test(id)) window.setTimeout(() => setSongId(id), 0);
    const initial=window.setTimeout(()=>void load(),0);
    void api<{songs:SongDTO[]}>("/api/songs?scope=mine&limit=80").then(r=>setSongs(r.songs)).catch(()=>{});
    const interval=window.setInterval(()=>void load(),5000);
    return ()=>{window.clearTimeout(initial);window.clearInterval(interval);};
  },[load]);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!files.length){toast.error("Añade al menos una imagen o un capítulo de manga");return;}
    if(files.length>12){toast.error("Máximo 12 imágenes; para más páginas utiliza un CBZ/ZIP");return;}
    if(!songId&&!audio&&!narration){toast.error("Selecciona una canción, agrega audio o activa las voces");return;}
    if(narration&&!script.trim()){toast.error("Escribe el guion para generar la voz");return;}
    setBusy(true);
    try{
      const form=new FormData();
      for(const [key,value] of Object.entries({title,mode,aspect,duration:String(duration),script,
        narration:String(narration),songId})){form.set(key,value);}
      for(const file of files)form.append("files",file,file.name);
      if(audio)form.append("files",audio,audio.name);
      const response=await fetch("/api/videos",{method:"POST",body:form});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw new Error(body.error||`Error ${response.status}`);
      toast.success("Proyecto enviado al motor de video local");
      await load();
    }catch(e){toast.error((e as Error).message);}
    finally{setBusy(false);}
  }

  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
    <form onSubmit={submit} className="space-y-5">
      <Card className="space-y-4">
        <div className="flex items-center gap-2"><Clapperboard className="h-5 w-5 text-brand"/><h2 className="font-display text-lg font-bold">Nuevo proyecto</h2></div>
        <Segmented value={mode} onChange={setMode} options={[
          {id:"imagenes",label:"Imágenes a video",icon:<FileImage className="h-4 w-4"/>},
          {id:"manga",label:"Manga a video",icon:<Film className="h-4 w-4"/>},
        ]}/>
        <Field label="Título"><Input value={title} maxLength={120} minLength={2} required onChange={e=>setTitle(e.target.value)}/></Field>
        <Field label={mode==="manga"?"Viñetas, páginas o capítulo CBZ/ZIP/PDF":"Imágenes para animar"} hint="PNG, JPG, WEBP, CBZ, ZIP o PDF">
          <Input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.zip,.cbz,.pdf" onChange={e=>setFiles(Array.from(e.target.files||[]))} />
        </Field>
        {files.length>0&&<div className="rounded-xl bg-surface-2 p-3 text-xs text-muted">
          {files.length} archivo(s) · {(files.reduce((a,f)=>a+f.size,0)/1048576).toFixed(1)} MB
          <p className="mt-1 max-h-24 overflow-y-auto break-all">{files.map(f=>f.name).join(" · ")}</p>
        </div>}
        <p className="text-xs text-muted">Las imágenes se mostrarán en orden. Un capítulo CBZ/ZIP se desplegará por página. PDF requiere que el motor local disponga de PyMuPDF.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Formato"><Select value={aspect} onChange={e=>setAspect(e.target.value as "16:9"|"9:16")}>
            <option value="16:9">16:9 · Horizontal</option><option value="9:16">9:16 · Vertical</option>
          </Select></Field>
          <Field label="Duración"><Select value={duration} onChange={e=>setDuration(Number(e.target.value))}>
            <option value={15}>15 segundos</option><option value={30}>30 segundos</option><option value={60}>60 segundos</option>
          </Select></Field>
        </div>
      </Card>
      <Card className="space-y-4">
        <div className="flex items-center gap-2"><Music2 className="h-5 w-5 text-brand"/><h2 className="font-display text-lg font-bold">Audio y voces</h2></div>
        <Field label="Canción de mi biblioteca" hint="opcional">
          <Select value={songId} onChange={e=>{setSongId(e.target.value);if(e.target.value)setAudio(null);}}>
            <option value="">Sin canción seleccionada</option>
            {songs.map(s=><option key={s.id} value={s.id}>{s.title} · {fmtTime(s.durationSec)}</option>)}
          </Select>
        </Field>
        <Field label="O subir una pista de audio" hint="MP3, WAV, M4A o FLAC">
          <Input type="file" accept=".mp3,.wav,.m4a,.flac" onChange={e=>{setAudio(e.target.files?.[0]||null);if(e.target.files?.length)setSongId("");}}/>
        </Field>
        <label className="flex items-start gap-3 rounded-xl bg-surface-2 px-3 py-3 text-sm">
          <input type="checkbox" checked={narration} onChange={e=>setNarration(e.target.checked)} className="mt-0.5 accent-[var(--brand)]"/>
          <span><span className="flex items-center gap-1 font-medium"><Mic2 className="h-4 w-4"/> Añadir narración</span>
          <span className="mt-1 block text-xs text-muted">Utiliza las voces instaladas en Windows. Puedes combinar la narración con música de fondo.</span></span>
        </label>
        <Field label="Guion o diálogos" hint="hasta 3000 caracteres"><Textarea rows={6} maxLength={3000} value={script}
          onChange={e=>setScript(e.target.value)} placeholder={"Narrador: Un día, comenzó la aventura.\nPersonaje: ¡Tenemos que continuar!"}/></Field>
        <p className="text-xs text-muted">Esta primera versión monta escenas con movimientos de cámara; no inventa los diálogos del manga ni genera movimiento corporal por difusión. Revisa el guion antes de usar voces.</p>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full"><Video className="h-4 w-4"/>Crear MP4</Button>
      </Card>
    </form>
    <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-display font-bold">Mis videos</h2>
          <Button size="icon" variant="ghost" onClick={()=>void load()} aria-label="Actualizar videos"><RefreshCw className="h-4 w-4"/></Button></div>
        {loading&&<p className="text-sm text-muted">Consultando proyectos…</p>}
        {!loading&&!videos.length&&<p className="text-sm text-muted">Todavía no has creado videos.</p>}
        {videos.map(v=><article key={v.id} className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold">{v.title}</p>
          <p className="text-xs text-muted">{v.mode==="manga"?"Manga":"Imágenes"} · {v.aspect} · {v.stage}</p>
          {v.status==="failed"&&<p className="text-xs text-bad">{v.error||"Error del procesador local"}</p>}
          {v.ready&&<><video controls preload="metadata" playsInline className="w-full rounded-lg" src={`/api/videos/${v.id}/file`} />
            <a href={`/api/videos/${v.id}/file?download=1`} className="inline-flex items-center gap-1 text-xs font-medium text-brand underline"><Download className="h-3 w-3"/>Descargar MP4</a></>}
        </article>)}
      </Card>
      <p className="text-xs text-muted">La generación se realiza en tu equipo. Mantén ComfyUI conectado. Los videos son privados y ocupan almacenamiento limitado en Render.</p>
    </aside>
  </div>;
}
