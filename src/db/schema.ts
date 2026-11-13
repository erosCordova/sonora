import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  bio: text("bio").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256 del token que vive en la cookie httpOnly
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResets = pgTable("password_resets", {
  id: text("id").primaryKey(), // sha256 del token enviado por correo
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    // Versión padre inmediata y raíz del árbol de versiones
    parentId: uuid("parent_id").references((): AnyPgColumn => songs.id, {
      onDelete: "set null",
    }),
    rootId: uuid("root_id"),
    versionKind: text("version_kind").notNull().default("original"), // original|variation|extend|restyle|repaint|trim
    title: text("title").notNull(),
    prompt: text("prompt").notNull().default(""),
    caption: text("caption").notNull().default(""),
    lyrics: text("lyrics").notNull().default(""),
    genre: text("genre").notNull().default(""),
    subgenre: text("subgenre").notNull().default(""),
    language: text("language").notNull().default(""),
    vocal: text("vocal").notNull().default("instrumental"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    engine: text("engine").notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull().default(""),
    durationSec: real("duration_sec").notNull(),
    audioKey: text("audio_key").notNull(),
    audioMime: text("audio_mime").notNull(),
    audioBytes: integer("audio_bytes").notNull(),
    coverSeed: text("cover_seed").notNull(),
    isFavorite: boolean("is_favorite").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("songs_user_idx").on(t.userId, t.createdAt),
    index("songs_public_idx").on(t.isPublic, t.createdAt),
    index("songs_root_idx").on(t.rootId),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull(), // variaciones de una misma solicitud
    kind: text("kind").notNull(), // generate | cover | repaint | extend
    status: text("status").notNull().default("pending"), // pending|running|completed|failed|cancelled
    title: text("title").notNull().default(""),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    parentSongId: uuid("parent_song_id").references(() => songs.id, {
      onDelete: "set null",
    }),
    songId: uuid("song_id"),
    engine: text("engine").notNull().default("acestep"),
    // progress: null = el motor no ha reportado progreso real
    progress: real("progress"),
    stage: text("stage").notNull().default("En cola"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    workerId: text("worker_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_status_idx").on(t.status, t.createdAt),
    index("jobs_user_idx").on(t.userId, t.createdAt),
  ],
);

export const workers = pgTable("workers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  engine: text("engine").notNull(),
  info: jsonb("info").$type<Record<string, unknown>>().notNull().default({}),
  currentJobId: uuid("current_job_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Song = typeof songs.$inferSelect;
export type Job = typeof jobs.$inferSelect;
