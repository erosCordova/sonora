import { z } from "zod";
import { LIMITS } from "@/lib/music-options";

const text = (max: number) => z.string().trim().max(max);

export const generateSchema = z
  .object({
    mode: z.enum(["simple", "custom"]),
    prompt: text(LIMITS.maxPrompt).default(""),
    title: text(LIMITS.maxTitle).default(""),
    lyrics: text(LIMITS.maxLyrics).default(""),
    genre: text(60).default(""),
    subgenre: text(60).default(""),
    language: text(8).default("auto"),
    vocal: z.enum(["instrumental", "male", "female", "duet", "choir"]).default("male"),
    voiceStyle: z.enum(["", "soft", "energetic", "emotional"]).default(""),
    instruments: z.array(text(40)).max(8).default([]),
    mood: text(30).default(""),
    intensity: z.enum(["", "low", "mid", "high"]).default(""),
    structure: text(30).default(""),
    bpm: z.number().int().min(LIMITS.minBpm).max(LIMITS.maxBpm).nullable().default(null),
    duration: z.number().int().min(LIMITS.minDuration).max(LIMITS.maxDuration).nullable().default(null),
    variations: z.number().int().min(1).max(2).default(1),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "simple" && v.prompt.length < 5)
      ctx.addIssue({ code: "custom", path: ["prompt"], message: "Describe tu canción (mínimo 5 caracteres)" });
    if (v.mode === "custom" && !v.prompt && !v.genre && !v.lyrics)
      ctx.addIssue({ code: "custom", path: ["genre"], message: "Indica al menos un género, una descripción o una letra" });
  });
export type GenerateInput = z.infer<typeof generateSchema>;

export const editSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("variation"),
    songId: z.string().uuid(),
    variations: z.number().int().min(1).max(2).default(1),
  }),
  z.object({
    operation: z.literal("restyle"),
    songId: z.string().uuid(),
    caption: text(600).min(3),
    lyrics: text(LIMITS.maxLyrics).default(""),
    language: text(8).default(""),
    strength: z.number().min(0.2).max(0.95).default(0.6),
  }),
  z.object({
    operation: z.literal("extend"),
    songId: z.string().uuid(),
    seconds: z.number().int().min(10).max(90),
    caption: text(600).default(""),
    lyrics: text(LIMITS.maxLyrics).default(""),
  }),
  z.object({
    operation: z.literal("repaint"),
    songId: z.string().uuid(),
    start: z.number().min(0),
    end: z.number().min(1),
    caption: text(600).default(""),
    lyrics: text(LIMITS.maxLyrics).default(""),
  }),
]);
export type EditInput = z.infer<typeof editSchema>;

export const lyricsSchema = z.object({
  action: z.enum(["generate", "section"]).default("generate"),
  theme: text(400).min(3, "Indica una temática"),
  language: text(8).default("es"),
  length: z.enum(["short", "medium", "long"]).default("medium"),
  structure: text(30).default("classic"),
  genre: text(60).default(""),
  mood: text(30).default(""),
  lyrics: text(LIMITS.maxLyrics).default(""),
  sectionIndex: z.number().int().min(0).optional(),
});

export const registerSchema = z.object({
  name: text(80).min(2, "Nombre demasiado corto"),
  email: z.string().trim().toLowerCase().email("Correo inválido").max(200),
  password: z.string().min(8, "Mínimo 8 caracteres").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
