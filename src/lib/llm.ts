import "server-only";
import { LANGUAGES, LYRIC_LENGTHS, STRUCTURES, MOODS } from "@/lib/music-options";

// Cliente para cualquier servidor compatible con OpenAI (Ollama, llama.cpp, vLLM...).
// Sin LLM_BASE_URL no hay generación de letras y la API lo dice explícitamente.

export function llmConfig() {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  return {
    configured: Boolean(baseUrl),
    baseUrl,
    model: process.env.LLM_MODEL ?? "qwen2.5:7b-instruct",
    apiKey: process.env.LLM_API_KEY,
  };
}

export class LlmError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

async function chat(system: string, user: string, temperature = 0.9): Promise<string> {
  const cfg = llmConfig();
  if (!cfg.configured)
    throw new LlmError(
      "El servicio de letras no está configurado. Define LLM_BASE_URL (p. ej. Ollama en http://127.0.0.1:11434/v1) y LLM_MODEL.",
      503,
    );
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new LlmError(`No se pudo contactar con el modelo de lenguaje (${cfg.baseUrl}): ${(e as Error).message}`, 502);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(`El modelo de lenguaje respondió ${res.status}: ${body.slice(0, 300)}`, 502);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new LlmError("El modelo de lenguaje devolvió una respuesta vacía", 502);
  return content;
}

const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

function cleanLyrics(raw: string) {
  let t = raw.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();
  // normaliza etiquetas como "Verse 1:" o "**[Chorus]**" a "[Chorus]"
  t = t
    .split("\n")
    .map((l) => {
      const m = l.trim().replace(/^[*#\s]+|[*#\s]+$/g, "");
      const tag = m.match(/^\[?((?:intro|verse|pre-chorus|chorus|bridge|outro|instrumental|hook|final chorus)[^\]:]*)\]?:?$/i);
      return tag ? `[${tag[1].trim()}]` : l;
    })
    .join("\n");
  const firstTag = t.indexOf("[");
  if (firstTag > 0) t = t.slice(firstTag);
  return t.trim();
}

export function parseSections(lyrics: string) {
  const lines = lyrics.split("\n");
  const sections: { tag: string; start: number; end: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.trim().match(/^\[([^\]]+)\]$/);
    if (m) sections.push({ tag: m[1], start: i, end: lines.length });
  });
  sections.forEach((s, i) => {
    if (sections[i + 1]) s.end = sections[i + 1].start;
  });
  return { lines, sections };
}

const SYSTEM = `You are a professional songwriter. Write ORIGINAL song lyrics. Never reproduce or imitate existing copyrighted songs, and never mention real artists.
Output ONLY the lyrics, no explanations and no markdown. Every section must start with a structural tag on its own line, in English, in square brackets, such as [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro]. Lyrics text itself must be in the requested language. Keep lines singable (6-10 syllables), with consistent rhythm and rhyme.`;

export async function generateLyrics(opts: {
  theme: string;
  language: string;
  length: "short" | "medium" | "long";
  structure: string;
  genre?: string;
  mood?: string;
}) {
  const struct = STRUCTURES.find((s) => s.id === opts.structure) ?? STRUCTURES[0];
  const len = LYRIC_LENGTHS.find((l) => l.id === opts.length) ?? LYRIC_LENGTHS[1];
  const mood = MOODS.find((m) => m.id === opts.mood)?.label;
  const user = `Theme: ${opts.theme}
Language of the lyrics: ${langName(opts.language)}
${opts.genre ? `Genre: ${opts.genre}\n` : ""}${mood ? `Mood: ${mood}\n` : ""}Sections in order: ${struct.tags.map((t) => `[${t}]`).join(" ")}
Length: ${len.lines}. Instrumental intro/outro sections must contain only the tag and no text.`;
  const out = cleanLyrics(await chat(SYSTEM, user));
  if (!out.includes("[")) throw new LlmError("El modelo no devolvió etiquetas estructurales válidas. Inténtalo de nuevo.");
  return out;
}

export async function regenerateSection(opts: {
  lyrics: string;
  sectionIndex: number;
  theme: string;
  language: string;
}) {
  const { lines, sections } = parseSections(opts.lyrics);
  const sec = sections[opts.sectionIndex];
  if (!sec) throw new LlmError("La sección indicada no existe", 422);
  const user = `Full lyrics so far:\n${opts.lyrics}\n\nRewrite ONLY the section ${lines[sec.start]} with new original text that fits the rest of the song. Theme: ${opts.theme}. Language: ${langName(opts.language)}.\nOutput only that section, starting with its tag line ${lines[sec.start]}.`;
  const out = cleanLyrics(await chat(SYSTEM, user));
  const newLines = out.split("\n");
  if (newLines[0]?.trim() !== lines[sec.start].trim()) newLines.unshift(lines[sec.start]);
  const merged = [...lines.slice(0, sec.start), ...newLines, "", ...lines.slice(sec.end).filter((_, i, a) => !(i === 0 && a[0].trim() === ""))];
  return merged.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface InterpretedPrompt {
  title: string;
  caption: string;
  lyrics: string;
  language: string;
  bpm: number | null;
}

/** Modo simple: interpreta la descripción libre en parámetros de composición. */
export async function interpretPrompt(opts: {
  prompt: string;
  instrumental: boolean;
  language: string;
}): Promise<InterpretedPrompt> {
  const system = `You are a music producer's assistant. Convert the user's song request into a JSON object with keys:
"title" (short original title in the lyrics language), "caption" (English comma-separated style description: genre, mood, instruments, vocal type, energy, production), "language" (ISO 639-1 code of the lyrics, e.g. es, en, ja), "bpm" (integer 50-200 or null), "lyrics" (${opts.instrumental ? 'must be "[Instrumental]"' : "original lyrics with structural tags [Intro] [Verse 1] [Chorus] [Verse 2] [Chorus] [Bridge] [Chorus] [Outro], in the requested lyrics language"}).
Respond with ONLY the JSON object. Never imitate copyrighted songs or name real artists.`;
  const user = `Request: ${opts.prompt}\nLyrics language: ${opts.language === "auto" ? "infer it from the request (default Spanish)" : langName(opts.language)}\nInstrumental: ${opts.instrumental}`;
  const raw = await chat(system, user, 0.8);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new LlmError("El modelo no devolvió JSON válido al interpretar la solicitud");
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    throw new LlmError("El modelo devolvió JSON malformado al interpretar la solicitud");
  }
  const bpm = typeof obj.bpm === "number" && obj.bpm >= 50 && obj.bpm <= 200 ? Math.round(obj.bpm) : null;
  return {
    title: String(obj.title ?? "").slice(0, 120),
    caption: String(obj.caption ?? opts.prompt).slice(0, 600),
    lyrics: opts.instrumental ? "[Instrumental]" : cleanLyrics(String(obj.lyrics ?? "")),
    language: String(obj.language ?? (opts.language === "auto" ? "es" : opts.language)).slice(0, 8),
    bpm,
  };
}
