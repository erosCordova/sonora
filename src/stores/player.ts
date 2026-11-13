import { create } from "zustand";
import type { SongDTO } from "@/lib/client/api";

type Repeat = "off" | "all" | "one";

interface PlayerState {
  queue: SongDTO[];
  index: number;
  playing: boolean;
  repeat: Repeat;
  shuffle: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  expanded: boolean;
  seekRequest: { t: number; n: number } | null;
  current: () => SongDTO | null;
  playQueue: (songs: SongDTO[], startId?: string) => void;
  enqueue: (song: SongDTO) => void;
  playNext: (song: SongDTO) => void;
  removeFromQueue: (id: string) => void;
  jumpTo: (index: number) => void;
  toggle: () => void;
  setPlaying: (p: boolean) => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  skip: (delta: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  setTime: (t: number, d?: number) => void;
  setExpanded: (e: boolean) => void;
  patchSong: (id: string, patch: Partial<SongDTO>) => void;
  dropSong: (id: string) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  repeat: "off",
  shuffle: false,
  volume: 0.85,
  muted: false,
  currentTime: 0,
  duration: 0,
  expanded: false,
  seekRequest: null,
  current: () => get().queue[get().index] ?? null,
  playQueue: (songs, startId) => {
    const idx = startId ? Math.max(0, songs.findIndex((s) => s.id === startId)) : 0;
    set({ queue: songs, index: songs.length ? idx : -1, playing: songs.length > 0, currentTime: 0 });
  },
  enqueue: (song) => {
    const { queue } = get();
    if (queue.some((s) => s.id === song.id)) return;
    set(queue.length ? { queue: [...queue, song] } : { queue: [song], index: 0, playing: true });
  },
  playNext: (song) => {
    const { queue, index } = get();
    if (!queue.length) return set({ queue: [song], index: 0, playing: true });
    const rest = queue.filter((s) => s.id !== song.id);
    const cur = queue[index];
    const at = Math.max(0, rest.findIndex((s) => s.id === cur?.id));
    rest.splice(at + 1, 0, song);
    set({ queue: rest, index: rest.findIndex((s) => s.id === cur?.id) });
  },
  removeFromQueue: (id) => {
    const { queue, index } = get();
    const cur = queue[index];
    const nq = queue.filter((s) => s.id !== id);
    if (cur?.id === id) set({ queue: nq, index: nq.length ? Math.min(index, nq.length - 1) : -1, playing: nq.length > 0 && get().playing });
    else set({ queue: nq, index: nq.findIndex((s) => s.id === cur?.id) });
  },
  jumpTo: (index) => set({ index, playing: true, currentTime: 0 }),
  toggle: () => set({ playing: get().index >= 0 ? !get().playing : false }),
  setPlaying: (playing) => set({ playing }),
  next: (auto = false) => {
    const { queue, index, repeat, shuffle } = get();
    if (!queue.length) return;
    if (auto && repeat === "one") return set({ seekRequest: { t: 0, n: Date.now() }, playing: true });
    if (shuffle && queue.length > 1) {
      let r = index;
      while (r === index) r = Math.floor(Math.random() * queue.length);
      return set({ index: r, playing: true, currentTime: 0 });
    }
    if (index < queue.length - 1) return set({ index: index + 1, playing: true, currentTime: 0 });
    if (repeat === "all" || !auto) return set({ index: 0, playing: repeat === "all" || !auto, currentTime: 0 });
    set({ playing: false, seekRequest: { t: 0, n: Date.now() } });
  },
  prev: () => {
    const { queue, index, currentTime } = get();
    if (currentTime > 3 || index <= 0) return set({ seekRequest: { t: 0, n: Date.now() } });
    set({ index: index - 1, playing: true, currentTime: 0, queue });
  },
  seek: (t) => set({ seekRequest: { t, n: Date.now() }, currentTime: t }),
  skip: (delta) => {
    const { currentTime, duration } = get();
    const t = Math.min(Math.max(0, currentTime + delta), duration || currentTime + delta);
    set({ seekRequest: { t, n: Date.now() }, currentTime: t });
  },
  setVolume: (volume) => set({ volume, muted: false }),
  toggleMute: () => set({ muted: !get().muted }),
  cycleRepeat: () => set({ repeat: ({ off: "all", all: "one", one: "off" } as const)[get().repeat] }),
  toggleShuffle: () => set({ shuffle: !get().shuffle }),
  setTime: (currentTime, duration) => set(duration !== undefined ? { currentTime, duration } : { currentTime }),
  setExpanded: (expanded) => set({ expanded }),
  patchSong: (id, patch) => set({ queue: get().queue.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
  dropSong: (id) => get().removeFromQueue(id),
}));
