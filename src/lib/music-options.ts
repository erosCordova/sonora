// Opciones musicales compartidas entre UI y servidor.
// Todas se traducen a parámetros reales del motor (caption, bpm, duration,
// vocal_language, etiquetas estructurales de la letra).

export const GENRES: Record<string, string[]> = {
  Pop: ["Synth-pop", "Indie pop", "Dance pop", "Balada pop", "K-pop", "J-pop"],
  Rock: ["Rock alternativo", "Hard rock", "Punk rock", "Rock japonés", "Rock épico", "Indie rock"],
  Metal: ["Heavy metal", "Power metal", "Metal sinfónico", "Metalcore"],
  "Hip hop": ["Trap", "Boom bap", "Lo-fi hip hop", "Drill"],
  Electrónica: ["House", "Techno", "Trance", "Drum and bass", "Synthwave", "Ambient"],
  Latina: ["Reguetón", "Salsa", "Bachata", "Cumbia", "Bossa nova", "Mariachi"],
  "R&B / Soul": ["Neo soul", "R&B contemporáneo", "Funk", "Gospel"],
  Jazz: ["Smooth jazz", "Bebop", "Swing", "Jazz fusión"],
  Folk: ["Folk acústico", "Country", "Celta", "Flamenco"],
  Clásica: ["Orquestal cinematográfico", "Piano solo", "Cámara", "Épico de tráiler"],
};

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "Inglés" },
  { code: "ja", label: "Japonés" },
  { code: "ko", label: "Coreano" },
  { code: "zh", label: "Chino" },
  { code: "fr", label: "Francés" },
  { code: "de", label: "Alemán" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Portugués" },
  { code: "ru", label: "Ruso" },
];

export const VOICE_GENDERS = [
  { id: "male", label: "Masculina", caption: "male lead vocals" },
  { id: "female", label: "Femenina", caption: "female lead vocals" },
  { id: "duet", label: "Dueto", caption: "male and female duet vocals" },
  { id: "choir", label: "Coros", caption: "powerful choir backing vocals, group harmonies" },
] as const;

export const VOICE_STYLES = [
  { id: "soft", label: "Suave", caption: "soft gentle intimate singing" },
  { id: "energetic", label: "Enérgico", caption: "powerful energetic singing" },
  { id: "emotional", label: "Emocional", caption: "emotional expressive vocal performance" },
] as const;

export const INSTRUMENTS: { id: string; label: string; caption: string }[] = [
  { id: "electric-guitar", label: "Guitarra eléctrica", caption: "electric guitars" },
  { id: "acoustic-guitar", label: "Guitarra acústica", caption: "acoustic guitar" },
  { id: "piano", label: "Piano", caption: "piano" },
  { id: "synth", label: "Sintetizadores", caption: "synthesizers" },
  { id: "drums", label: "Batería", caption: "drums" },
  { id: "bass", label: "Bajo", caption: "bass guitar" },
  { id: "strings", label: "Cuerdas", caption: "string section" },
  { id: "brass", label: "Metales", caption: "brass section" },
  { id: "orchestra", label: "Orquesta", caption: "full orchestra" },
  { id: "percussion", label: "Percusión", caption: "world percussion" },
  { id: "saxophone", label: "Saxofón", caption: "saxophone" },
  { id: "violin", label: "Violín", caption: "violin" },
];

export const MOODS: { id: string; label: string; caption: string }[] = [
  { id: "epic", label: "Épico", caption: "epic, cinematic atmosphere" },
  { id: "happy", label: "Alegre", caption: "happy, uplifting" },
  { id: "sad", label: "Melancólico", caption: "melancholic, sad" },
  { id: "romantic", label: "Romántico", caption: "romantic, tender" },
  { id: "dark", label: "Oscuro", caption: "dark, moody" },
  { id: "calm", label: "Sereno", caption: "calm, relaxing" },
  { id: "angry", label: "Intenso", caption: "aggressive, intense" },
  { id: "hopeful", label: "Esperanzador", caption: "hopeful, inspiring" },
];

export const INTENSITIES = [
  { id: "low", label: "Baja", caption: "low energy, mellow dynamics" },
  { id: "mid", label: "Media", caption: "medium energy" },
  { id: "high", label: "Alta", caption: "high energy, driving, powerful dynamics" },
] as const;

export const STRUCTURES: { id: string; label: string; tags: string[] }[] = [
  { id: "classic", label: "Clásica (V–C–V–C–Puente–C)", tags: ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus", "Outro"] },
  { id: "short", label: "Corta (V–C–V–C)", tags: ["Verse 1", "Chorus", "Verse 2", "Chorus"] },
  { id: "pre", label: "Con pre-estribillo", tags: ["Intro", "Verse 1", "Pre-Chorus", "Chorus", "Verse 2", "Pre-Chorus", "Chorus", "Bridge", "Chorus", "Outro"] },
  { id: "simple", label: "Estribillo repetido", tags: ["Verse", "Chorus", "Chorus"] },
];

export const LYRIC_LENGTHS = [
  { id: "short", label: "Corta", lines: "4 líneas por estrofa y 4 por estribillo" },
  { id: "medium", label: "Media", lines: "6 líneas por estrofa y 4 a 6 por estribillo" },
  { id: "long", label: "Larga", lines: "8 líneas por estrofa y 6 por estribillo" },
] as const;

export const LIMITS = {
  minDuration: 30,
  maxDuration: 240,
  minBpm: 50,
  maxBpm: 200,
  maxLyrics: 4000,
  maxPrompt: 1000,
  maxTitle: 120,
};

export function languageLabel(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export interface CaptionInput {
  genre?: string;
  subgenre?: string;
  vocal?: string; // instrumental | gender id
  voiceStyle?: string;
  instruments?: string[];
  mood?: string;
  intensity?: string;
  bpm?: number | null;
}

/** Compone el "caption" (descripción de estilo) que consume el motor. */
export function buildCaption(i: CaptionInput): string {
  const parts: string[] = [];
  if (i.genre) parts.push(i.genre);
  if (i.subgenre) parts.push(i.subgenre);
  const mood = MOODS.find((m) => m.id === i.mood);
  if (mood) parts.push(mood.caption);
  const inten = INTENSITIES.find((m) => m.id === i.intensity);
  if (inten) parts.push(inten.caption);
  for (const id of i.instruments ?? []) {
    const ins = INSTRUMENTS.find((x) => x.id === id);
    if (ins) parts.push(ins.caption);
  }
  if (i.vocal === "instrumental") {
    parts.push("instrumental, no vocals");
  } else {
    const g = VOICE_GENDERS.find((x) => x.id === i.vocal);
    if (g) parts.push(g.caption);
    const s = VOICE_STYLES.find((x) => x.id === i.voiceStyle);
    if (s) parts.push(s.caption);
  }
  if (i.bpm) parts.push(`${i.bpm} BPM`);
  return parts.join(", ");
}
