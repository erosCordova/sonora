"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Download } from "lucide-react";
import { Card } from "@/components/ui";
import { api } from "@/lib/client/api";
type Video = {id:string;title:string;mode:string;ready:boolean;status:string;stage:string;error:string|null};
export function VideoLibrary() {
  const [items,setItems]=useState<Video[]>([]);
  useEffect(()=>{
    let mounted=true;
    const refresh=()=>void api<{videos:Video[]}>("/api/videos").then(r=>{if(mounted)setItems(r.videos);}).catch(()=>{});
    const initial=window.setTimeout(refresh,0);
    const timer=window.setInterval(refresh,8000);
    return ()=>{mounted=false;window.clearTimeout(initial);window.clearInterval(timer);};
  },[]);
  return <section className="mt-10 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-display text-xl font-bold">Mis videos</h2>
      <p className="text-sm text-muted">Videos privados y videoclips exportados a MP4.</p></div>
      <Link href="/videos" className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white">
        <Clapperboard className="h-4 w-4"/>Crear video
      </Link>
    </div>
    {!items.length?<Card><p className="text-sm text-muted">No tienes videos todavía. Puedes animar imágenes o un capítulo de manga en Crear videos.</p></Card>:
    <div className="grid gap-4 sm:grid-cols-2">{items.map(v=><Card key={v.id} className="space-y-3">
      <h3 className="font-semibold">{v.title}</h3>
      <p className="text-xs text-muted">{v.mode==="manga"?"Manga":"Imágenes"} · {v.stage}</p>
      {v.ready?<><video controls playsInline preload="metadata" src={"/api/videos/"+v.id+"/file"} className="aspect-video w-full rounded-xl bg-black"/>
        <a href={"/api/videos/"+v.id+"/file?download=1"} className="inline-flex items-center gap-2 text-sm font-semibold text-brand underline">
          <Download className="h-4 w-4"/>Descargar MP4
        </a></>:v.error?<p className="text-sm text-bad">{v.error}</p>:<p className="text-xs text-muted">Se actualizará cuando termine el motor local.</p>}
      </Card>)}</div>}
  </section>;
}