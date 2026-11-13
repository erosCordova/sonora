import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { songs, users, type Song } from "@/db/schema";

export function serializeSong(s: Song, viewerId: string, ownerName?: string) {
  return {
    id: s.id,
    title: s.title,
    prompt: s.prompt,
    caption: s.caption,
    lyrics: s.lyrics,
    genre: s.genre,
    subgenre: s.subgenre,
    language: s.language,
    vocal: s.vocal,
    durationSec: s.durationSec,
    createdAt: s.createdAt,
    isFavorite: s.userId === viewerId ? s.isFavorite : false,
    isPublic: s.isPublic,
    isOwner: s.userId === viewerId,
    ownerName: ownerName ?? null,
    coverSeed: s.coverSeed,
    versionKind: s.versionKind,
    parentId: s.parentId,
    rootId: s.rootId,
    engine: s.engine,
    model: s.model,
    modelVersion: s.modelVersion,
    audioBytes: s.audioBytes,
    audioMime: s.audioMime,
    params: s.userId === viewerId ? s.params : {},
  };
}

export type SongDTO = ReturnType<typeof serializeSong>;

/** Devuelve la canción si el usuario es dueño o si es pública. */
export async function getAccessibleSong(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ song: songs, ownerName: users.name })
    .from(songs)
    .innerJoin(users, eq(users.id, songs.userId))
    .where(and(eq(songs.id, id), or(eq(songs.userId, userId), eq(songs.isPublic, true))))
    .limit(1);
  return row ?? null;
}

export async function getOwnedSong(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(songs)
    .where(and(eq(songs.id, id), eq(songs.userId, userId)))
    .limit(1);
  return row ?? null;
}

export function fileSlug(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "cancion"
  );
}
