import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { songs, users } from "@/db/schema";
import { withUser } from "@/lib/http";
import { serializeSong } from "@/lib/songs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await withUser();
  if (a.res) return a.res;
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") === "public" ? "public" : "mine";
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const genre = (sp.get("genre") ?? "").trim().slice(0, 60);
  const vocal = sp.get("vocal");
  const fav = sp.get("fav") === "1";
  const sort = sp.get("sort") ?? "new";
  const limit = Math.min(Number(sp.get("limit") ?? 60) || 60, 120);

  const conds = [scope === "public" ? eq(songs.isPublic, true) : eq(songs.userId, a.user.id)];
  if (fav && scope === "mine") conds.push(eq(songs.isFavorite, true));
  if (genre) conds.push(eq(songs.genre, genre));
  if (vocal === "instrumental") conds.push(eq(songs.vocal, "instrumental"));
  if (vocal === "vocal") conds.push(sql`${songs.vocal} <> 'instrumental'`);
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(songs.title, like), ilike(songs.lyrics, like), ilike(songs.caption, like), ilike(songs.genre, like))!);
  }
  const order = sort === "old" ? asc(songs.createdAt) : sort === "title" ? asc(songs.title) : desc(songs.createdAt);
  const rows = await db
    .select({ song: songs, ownerName: users.name })
    .from(songs)
    .innerJoin(users, eq(users.id, songs.userId))
    .where(and(...conds))
    .orderBy(order)
    .limit(limit);
  return Response.json({ songs: rows.map((r) => serializeSong(r.song, a.user.id, r.ownerName)) });
}
