"use client";
import { AlertTriangle, Disc3, ListPlus, Loader2, Mic2, RefreshCw, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { JobsList } from "@/components/JobsList";
import { Button, Card, Chip, Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import { api, type JobDTO } from "@/lib/client/api";
import {
  GENRES, INSTRUMENTS, INTENSITIES, LANGUAGES, LIMITS, LYRIC_LENGTHS, MOODS, STRUCTURES, VOICE_GENDERS, VOICE_STYLES,
} from "@/lib/music-options";
import { useJobs } from "@/stores/jobs";
import { toast } from "@/stores/toast";

type Mode = "simple" | "custom";
type Vocal = "instrumental" | "male" | "female" | "duet" | "choir";

function sectionsOf(lyrics: string) {
  return lyrics.split("\n").map((l) => l.trim().match(/^\[([^\]]+)\]$/)?.[1]).filter((x): x is string => Boolean(x));
}

export function CreateStudio({ initialPrompt = "" }: { initialPrompt?: string }) {
  const system = useJobs((s) => s.system);
  const [mode, setMode] = useState<Mode>("simple");
  const [submitting, setSubmitting] = useState(false);

  // comunes
  const [prompt, setPrompt] = useState(initialPrompt);
  const [vocal, setVocal] = useState<Vocal>("male");
  const [language, setLanguage] = useState("auto");
  const [variations, setVariations] = useState(1);
  // personalizado
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [subgenre, setSubgenre] = useState("");
  const [voiceStyle, setVoiceStyle] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [mood, setMood] = useState("");
  const [intensity, setIntensity] = useState("");
  const [autoBpm, setAutoBpm] = useState(true);
  const [bpm, setBpm] = useState(110);
  const [duration, setDuration] = useState(120);
  const [structure, setStructure] = useState("classic");
  const [lyrics, setLyrics] = useState("");
  // letras
  const [theme, setTheme] = useState("");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [section, setSection] = useState(0);

  const vocalOn = vocal !== "instrumental";
  const sections = useMemo(() => sectionsOf(lyrics), [lyrics]);
  const llm = system?.llm.configured ?? false;
  const langForLyrics = language === "auto" ? "es" : language;

  const toggleInstrument = (id: string) =>
    setInstruments((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 8 ? [...cur, id] : cur));

  async function genLyrics(action: "generate" | "section") {
    setLyricsBusy(true);
    try {
      const r = await api<{ lyrics: string }>("/api/lyrics", {
        method: "POST",
        json: { action, theme: theme || prompt, language: langForLyrics, length, structure, genre, mood, lyrics, sectionIndex: section },
      });
      setLyrics(r.lyrics);
      toast.success(action === "generate" ? "Letra generada" : "Sección regenerada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLyricsBusy(false);
    }
  }

  function insertTemplate() {
    const tags = (STRUCTURES.find((s) => s.id === structure) ?? STRUCTURES[0]).tags;
    setLyrics(tags.map((t) => `[${t}]\n`).join("\n"));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body =
        mode === "simple"
          ? { mode, prompt, vocal: vocal === "instrumental" ? "instrumental" : vocal === "male" || vocal === "female" ? vocal : "male", language, variations }
          : {
              mode, prompt, title, genre, subgenre, vocal, voiceStyle: vocalOn ? voiceStyle : "", language: vocalOn ? language : "auto",
              instruments, mood, intensity, structure: vocalOn ? structure : "", lyrics: vocalOn ? lyrics : "",
              bpm: autoBpm ? null : bpm, duration, variations,
            };
      const r = await api<{ jobs: JobDTO[] }>("/api/jobs", { method: "POST", json: body });
      useJobs.getState().track(r.jobs);
      toast.info(r.jobs.length > 1 ? "Se crearon 2 tareas independientes" : "Tarea creada y en cola");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const simpleVocal: "voice" | "instrumental" = vocal === "instrumental" ? "instrumental" : "voice";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form onSubmit={submit} className="space-y-5">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { id: "simple", label: "Simple", icon: <Wand2 className="h-4 w-4" /> },
            { id: "custom", label: "Personalizado", icon: <SlidersHorizontal className="h-4 w-4" /> },
          ]}
        />

        {mode === "simple" ? (
          <Card className="space-y-5">
            <Field label="Describe tu canción" hint={`${prompt.length}/${LIMITS.maxPrompt}`}>
              <Textarea
                rows={6}
                required
                minLength={5}
                maxLength={LIMITS.maxPrompt}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Rock japonés con voz masculina, guitarras eléctricas, batería intensa y un estribillo emocionante. Letra en español sobre superar las adversidades."
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Voz">
                <Segmented value={simpleVocal} onChange={(v) => setVocal(v === "voice" ? "male" : "instrumental")} options={[{ id: "voice", label: "Con voz", icon: <Mic2 className="h-4 w-4" /> }, { id: "instrumental", label: "Instrumental" }]} />
              </Field>
              {vocalOn && (
                <Field label="Idioma de la letra">
                  <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="auto">Automático (según tu descripción)</option>
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <p className="text-xs text-muted">
              {llm
                ? "Prepararemos el estilo y la letra a partir de tu descripción antes de crear la canción."
                : "Si eliges una canción con voz, el motor intentará componer la letra. También puedes escribirla en el modo personalizado."}
            </p>
          </Card>
        ) : (
          <>
            <Card className="space-y-4">
              <h2 className="font-display font-bold">Concepto</h2>
              <Field label="Título" hint="opcional"><Input value={title} maxLength={LIMITS.maxTitle} onChange={(e) => setTitle(e.target.value)} placeholder="Sin título" /></Field>
              <Field label="Descripción adicional" hint="opcional — se añade al estilo">
                <Textarea rows={2} maxLength={LIMITS.maxPrompt} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Atmósfera épica, estribillo que crece, final con coro…" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Género">
                  <Select value={genre} onChange={(e) => { setGenre(e.target.value); setSubgenre(""); }}>
                    <option value="">Sin especificar</option>
                    {Object.keys(GENRES).map((g) => <option key={g}>{g}</option>)}
                  </Select>
                </Field>
                {genre && (
                  <Field label="Subgénero">
                    <Select value={subgenre} onChange={(e) => setSubgenre(e.target.value)}>
                      <option value="">Cualquiera</option>
                      {GENRES[genre].map((g) => <option key={g}>{g}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
            </Card>

            <Card className="space-y-4">
              <h2 className="font-display font-bold">Voz</h2>
              <div className="flex flex-wrap gap-2">
                <Chip active={vocal === "instrumental"} onClick={() => setVocal("instrumental")}>Sin voz (instrumental)</Chip>
                {VOICE_GENDERS.map((g) => <Chip key={g.id} active={vocal === g.id} onClick={() => setVocal(g.id)}>{g.label}</Chip>)}
              </div>
              {vocalOn && (
                <>
                  <Field label="Interpretación">
                    <div className="flex flex-wrap gap-2">
                      {VOICE_STYLES.map((v) => <Chip key={v.id} active={voiceStyle === v.id} onClick={() => setVoiceStyle(voiceStyle === v.id ? "" : v.id)}>{v.label}</Chip>)}
                    </div>
                  </Field>
                  <Field label="Idioma de la letra">
                    <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option value="auto">Automático</option>
                      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </Select>
                  </Field>
                </>
              )}
              <p className="text-xs text-muted">Los estilos de voz se expresan en la descripción que recibe el modelo; su cumplimiento depende del motor. No se clonan voces de personas reales.</p>
            </Card>

            <Card className="space-y-4">
              <h2 className="font-display font-bold">Sonido</h2>
              <Field label="Instrumentos" hint={`${instruments.length}/8`}>
                <div className="flex flex-wrap gap-2">{INSTRUMENTS.map((i) => <Chip key={i.id} active={instruments.includes(i.id)} onClick={() => toggleInstrument(i.id)}>{i.label}</Chip>)}</div>
              </Field>
              <Field label="Emoción">
                <div className="flex flex-wrap gap-2">{MOODS.map((m) => <Chip key={m.id} active={mood === m.id} onClick={() => setMood(mood === m.id ? "" : m.id)}>{m.label}</Chip>)}</div>
              </Field>
              <Field label="Intensidad">
                <div className="flex flex-wrap gap-2">{INTENSITIES.map((m) => <Chip key={m.id} active={intensity === m.id} onClick={() => setIntensity(intensity === m.id ? "" : m.id)}>{m.label}</Chip>)}</div>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={`Tempo: ${autoBpm ? "automático" : `${bpm} BPM`}`}>
                  <div className="flex items-center gap-3">
                    <input type="range" min={LIMITS.minBpm} max={LIMITS.maxBpm} value={bpm} disabled={autoBpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-[var(--brand)] disabled:opacity-40" aria-label="Tempo" />
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs"><input type="checkbox" checked={autoBpm} onChange={(e) => setAutoBpm(e.target.checked)} />Auto</label>
                  </div>
                </Field>
                <Field label={`Duración: ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`}>
                  <input type="range" min={LIMITS.minDuration} max={LIMITS.maxDuration} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full accent-[var(--brand)]" aria-label="Duración" />
                </Field>
              </div>
            </Card>

            {vocalOn && (
              <Card className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display font-bold">Letra y estructura</h2>
                  <Field label="Estructura" className="w-64 max-w-full">
                    <Select value={structure} onChange={(e) => setStructure(e.target.value)}>
                      {STRUCTURES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </Select>
                  </Field>
                </div>

                <div className="space-y-3 rounded-xl bg-surface-2 p-3">
                  <Field label="Temática de la letra"><Input value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={400} placeholder="Superar las adversidades y volver a levantarse" /></Field>
                  <div className="flex flex-wrap items-center gap-2">
                    {LYRIC_LENGTHS.map((l) => <Chip key={l.id} active={length === l.id} onClick={() => setLength(l.id)}>{l.label}</Chip>)}
                    <Button type="button" size="sm" variant="primary" disabled={!llm || (!theme && !prompt)} loading={lyricsBusy} onClick={() => genLyrics("generate")}><Sparkles className="h-3.5 w-3.5" />Generar letra</Button>
                    <Button type="button" size="sm" onClick={insertTemplate}><ListPlus className="h-3.5 w-3.5" />Insertar estructura vacía</Button>
                  </div>
                  {sections.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={section} onChange={(e) => setSection(Number(e.target.value))} className="w-auto" aria-label="Sección">
                        {sections.map((s, i) => <option key={i} value={i}>[{s}]</option>)}
                      </Select>
                      <Button type="button" size="sm" disabled={!llm || (!theme && !prompt)} loading={lyricsBusy} onClick={() => genLyrics("section")}><RefreshCw className="h-3.5 w-3.5" />Regenerar sección</Button>
                    </div>
                  )}
                  {system && !llm && (
                    <p className="flex items-start gap-1.5 text-xs text-warn"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />El generador de letras no está disponible por ahora. Puedes escribir la letra a mano o dejar que el motor musical intente crearla.</p>
                  )}
                </div>

                <Field label="Letra" hint={`${lyrics.length}/${LIMITS.maxLyrics} · etiquetas [Verse], [Chorus]…`}>
                  <Textarea rows={14} value={lyrics} maxLength={LIMITS.maxLyrics} onChange={(e) => setLyrics(e.target.value)} className="font-mono text-[13px]" placeholder={"[Verse 1]\n…\n\n[Chorus]\n…"} />
                </Field>
              </Card>
            )}
          </>
        )}

        <Card className="flex flex-wrap items-center justify-between gap-4">
          <Field label="Variaciones independientes" className="!space-y-1">
            <div className="flex gap-2">{[1, 2].map((n) => <Chip key={n} active={variations === n} onClick={() => setVariations(n)}>{n === 1 ? "1 canción" : "2 variaciones"}</Chip>)}</div>
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={submitting} className="min-w-48">
            <Disc3 className="h-5 w-5" />Crear canción
          </Button>
        </Card>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <StatusCard />
        <div>
          <h2 className="mb-3 font-display font-bold">Tus generaciones</h2>
          <JobsList />
          <EmptyJobs />
        </div>
      </aside>
    </div>
  );
}

function EmptyJobs() {
  const n = useJobs((s) => s.jobs.length);
  if (n) return null;
  return <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">Aquí verás el estado real de cada tarea: en cola, en ejecución, completada o fallida.</p>;
}

export function StatusCard() {
  const s = useJobs((x) => x.system);
  if (!s) return <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />;
  const w = s.workers.find((worker) => worker.engine === s.engine);
  const info = (w?.info ?? {}) as Record<string, string | number>;
  return (
    <Card className="space-y-2 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <span className={`h-2.5 w-2.5 rounded-full ${s.workerOnline ? "bg-ok" : "bg-bad"}`} />
        {s.workerOnline ? "Motor musical disponible" : "Motor musical desconectado"}
        {s.workerOnline && w && <Loader2 className={`ml-auto h-4 w-4 text-brand ${w.busy ? "animate-spin" : "hidden"}`} />}
      </div>
      {s.workerOnline && w ? (
        <p className="text-xs text-muted">
          {w.busy ? "Creando otra canción" : "Listo para crear"} · {String(info.model ?? s.engine)}
        </p>
      ) : (
        <p className="text-xs text-muted">Las canciones esperarán en cola hasta que el motor vuelva a estar disponible.</p>
      )}
      <p className="text-xs text-muted">En cola: {s.queued} · En ejecución: {s.running}</p>
    </Card>
  );
}
