"use client";
import { Download, Globe, Heart, ListPlus, ListEnd, Lock, MoreHorizontal, Music, Pause, Pencil, Play, Search, Trash2, Wand2, Mic2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cover } from "@/components/Cover";
import { SongDetail } from "@/components/SongDetail";
import { Button, Empty, Input, Modal, Select, cx } from "@/components/ui";
import { api, fmtDate, fmtTime, VERSION_LABELS, type SongDTO } from "@/lib/client/api";
import { GENRES } from "@/lib/music-options";
import { usePlayer } from "@/stores/player";
import { toast } from "@/stores/toast";
import Link from "next/link";

export function SongCard({ song, queue, onChange, onOpen }: { song: SongDTO; queue: SongDTO[]; onChange: (s: SongDTO | null) => void; onOpen: (id: string) => void }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const isCurrent = currentId === song.id;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(song.title);
  const [confirmDel, setConfirmDel] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu]);

  async function patch(p: Partial<Pick<SongDTO, "title" | "isFavorite" | "isPublic">>) {
    try {
      const { song: s } = await api<{ song: SongDTO }>(`/api/songs/${song.id}`, { method: "PATCH", json: p });
      onChange(s);
      usePlayer.getState().patchSong(song.id, s);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function download() {
    try {
      const { url } = await api<{ url: string }>(`/api/songs/${song.id}/url?download=1`);
      const a = document.createElement("a");
      a.href = url;
      a.click();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function remove() {
    try {
      await api(`/api/songs/${song.id}`, { method: "DELETE" });
      usePlayer.getState().dropSong(song.id);
      onChange(null);
      toast.success("Canción eliminada junto con su archivo de audio");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setConfirmDel(false);
  }
  function play() {
    if (isCurrent) usePlayer.getState().toggle();
    else usePlayer.getState().playQueue(queue, song.id);
  }

  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean) => (
    <button
      onClick={() => { setMenu(false); fn(); }}
      className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2", danger && "text-bad")}
    >
      {icon}{label}
    </button>
  );

  return (
    <article className="group rounded-2xl border border-line bg-surface p-3 transition hover:border-brand/40 hover:shadow-lg">
      <div className="relative overflow-hidden rounded-xl">
        <Cover seed={song.coverSeed} className="aspect-square w-full transition duration-500 group-hover:scale-105" />
        <button
          onClick={play}
          aria-label={isCurrent && playing ? "Pausar" : `Reproducir ${song.title}`}
          className={cx("absolute inset-0 grid place-items-center bg-black/30 transition", isCurrent ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100 max-lg:bg-transparent")}
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/95 text-black shadow-xl transition active:scale-90 max-lg:absolute max-lg:bottom-2 max-lg:right-2 max-lg:h-11 max-lg:w-11">
            {isCurrent && playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </span>
        </button>
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur">{fmtTime(song.durationSec)}</span>
        {isCurrent && playing && (
          <span className="absolute bottom-2 left-2 flex h-4 items-end gap-0.5">
            {[0, 1, 2, 3].map((i) => <i key={i} className="eq-bar block w-1 rounded-full bg-white" style={{ height: "100%", animationDelay: `${i * 0.15}s` }} />)}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={song.title}>{song.title}</h3>
          <p className="truncate text-xs text-muted">
            {song.isOwner ? fmtDate(song.createdAt) : `por ${song.ownerName}`} · {[song.genre, song.vocal === "instrumental" ? "Instrumental" : ""].filter(Boolean).join(" · ") || "IA"}
          </p>
          {song.versionKind !== "original" && <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">{VERSION_LABELS[song.versionKind]}</span>}
          {song.isPublic && song.isOwner && <span className="ml-1 mt-1 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">Pública</span>}
        </div>
        {song.isOwner && (
          <button onClick={() => patch({ isFavorite: !song.isFavorite })} aria-label={song.isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"} aria-pressed={song.isFavorite} className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-75 hover:bg-surface-2">
            <Heart className={cx("h-4 w-4", song.isFavorite ? "fill-brand-2 text-brand-2" : "text-muted")} />
          </button>
        )}
        <div ref={ref} className="relative">
          <button onClick={() => setMenu(!menu)} aria-label="Más acciones" aria-expanded={menu} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><MoreHorizontal className="h-4 w-4" /></button>
          {menu && (
            <div className="absolute bottom-full right-0 z-20 mb-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-2xl">
              {item(<Wand2 className="h-4 w-4" />, song.isOwner ? "Detalles, versiones y edición" : "Detalles", () => onOpen(song.id))}
              {item(<ListPlus className="h-4 w-4" />, "Añadir a la cola", () => { usePlayer.getState().enqueue(song); toast.info("Añadida a la cola"); })}
              {item(<ListEnd className="h-4 w-4" />, "Reproducir a continuación", () => usePlayer.getState().playNext(song))}
              {item(<Download className="h-4 w-4" />, "Descargar", download)}
              {song.isOwner && item(<Pencil className="h-4 w-4" />, "Cambiar nombre", () => { setName(song.title); setRenaming(true); })}
              {song.isOwner && item(song.isPublic ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />, song.isPublic ? "Hacer privada" : "Publicar en Explorar", () => patch({ isPublic: !song.isPublic }))}
              {song.isOwner && item(<Trash2 className="h-4 w-4" />, "Eliminar", () => setConfirmDel(true), true)}
            </div>
          )}
        </div>
      </div>

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Cambiar nombre">
        <form onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await patch({ title: name.trim() }); setRenaming(false); } }} className="space-y-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus aria-label="Título" />
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setRenaming(false)}>Cancelar</Button><Button type="submit" variant="primary">Guardar</Button></div>
        </form>
      </Modal>
      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title="Eliminar canción">
        <p className="text-sm text-muted">Se eliminará «{song.title}» y su archivo de audio de forma permanente. Las otras versiones se conservan.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmDel(false)}>Cancelar</Button><Button variant="danger" onClick={remove}>Eliminar</Button></div>
      </Modal>
    </article>
  );
}

export function SongList({ scope, favoritesOnly, emptyTitle, emptyText, compact, limit }: { scope: "mine" | "public"; favoritesOnly?: boolean; emptyTitle: string; emptyText: string; compact?: boolean; limit?: number }) {
  const [songs, setSongs] = useState<SongDTO[] | null>(null);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [vocal, setVocal] = useState("");
  const [sort, setSort] = useState("new");
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ scope, sort });
    if (limit) sp.set("limit", String(limit));
    if (q.trim()) sp.set("q", q.trim());
    if (genre) sp.set("genre", genre);
    if (vocal) sp.set("vocal", vocal);
    if (favoritesOnly) sp.set("fav", "1");
    try {
      const r = await api<{ songs: SongDTO[] }>(`/api/songs?${sp}`);
      setSongs(r.songs);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scope, sort, q, genre, vocal, favoritesOnly, limit]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    window.addEventListener("songs:changed", load);
    return () => window.removeEventListener("songs:changed", load);
  }, [load]);

  const filtered = Boolean(q || genre || vocal);
  const onChange = (id: string) => (s: SongDTO | null) => {
    if (!s) return setSongs((cur) => cur?.filter((x) => x.id !== id) ?? cur);
    if (favoritesOnly && !s.isFavorite) return setSongs((cur) => cur?.filter((x) => x.id !== id) ?? cur);
    setSongs((cur) => cur?.map((x) => (x.id === id ? s : x)) ?? cur);
  };

  return (
    <div>
      <div className={cx("mb-5 flex flex-wrap items-center gap-2", compact && "hidden")}>
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, letra o estilo…" className="pl-9" aria-label="Buscar" />
        </div>
        <Select value={genre} onChange={(e) => setGenre(e.target.value)} className="w-auto" aria-label="Género">
          <option value="">Todos los géneros</option>
          {Object.keys(GENRES).map((g) => <option key={g}>{g}</option>)}
        </Select>
        <Select value={vocal} onChange={(e) => setVocal(e.target.value)} className="w-auto" aria-label="Tipo">
          <option value="">Con y sin voz</option>
          <option value="vocal">Con voz</option>
          <option value="instrumental">Instrumental</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto" aria-label="Orden">
          <option value="new">Más recientes</option>
          <option value="old">Más antiguas</option>
          <option value="title">Título A–Z</option>
        </Select>
      </div>

      {error && <p className="mb-4 rounded-xl bg-bad/10 p-3 text-sm text-bad">{error}</p>}
      {songs === null && !error ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-surface-2" />)}
        </div>
      ) : songs && songs.length === 0 ? (
        <Empty
          icon={filtered ? <Search className="h-6 w-6" /> : <Music className="h-6 w-6" />}
          title={filtered ? "Sin resultados" : emptyTitle}
          text={filtered ? "Ninguna canción coincide con los filtros actuales." : emptyText}
          action={!filtered && scope === "mine" && !favoritesOnly ? <Link href="/create"><Button variant="primary">Crear mi primera canción</Button></Link> : undefined}
        />
      ) : (
        songs && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {songs.map((s) => <SongCard key={s.id} song={s} queue={songs} onChange={onChange(s.id)} onOpen={setDetail} />)}
            </div>
            <p className="mt-6 flex items-center gap-1.5 text-xs text-muted"><Mic2 className="h-3.5 w-3.5" />{songs.length} {songs.length === 1 ? "canción" : "canciones"}</p>
          </>
        )
      )}
      <SongDetail songId={detail} onClose={() => setDetail(null)} onChanged={load} />
    </div>
  );
}
