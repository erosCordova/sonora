import { ArrowRight, Clapperboard, ImagePlus, Music2, Sparkles, WandSparkles } from "lucide-react";
import Link from "next/link";
import { StatusCard } from "@/components/CreateStudio";
import { SongList } from "@/components/SongList";
import { Button } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Inicio — Sonora" };

export default async function Home() {
  const user = await requireUser();
  return (
    <div className="space-y-9">
      <section className="studio-hero relative isolate overflow-hidden rounded-[28px] px-6 py-8 sm:px-10 sm:py-12">
        <div className="studio-mosaic pointer-events-none absolute inset-y-0 right-0 hidden w-2/5 opacity-35 sm:block"/>
        <div className="pointer-events-none absolute -right-12 top-1/2 hidden -translate-y-1/2 rounded-full border border-white/20 p-12 lg:block">
          <div className="grid h-40 w-40 place-items-center rounded-full border border-white/30 bg-white/10">
            <Music2 className="h-16 w-16 text-white/85"/>
          </div>
        </div>
        <div className="relative max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
            <Sparkles className="h-3.5 w-3.5"/> Tu estudio creativo con IA
          </p>
          <h1 className="mt-5 max-w-xl font-display text-3xl font-bold tracking-tight sm:text-[2.8rem] sm:leading-[1.14]">
            Tu próxima idea merece <span className="text-[#d7d4ff]">sonar y verse increíble.</span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/85">
            Hola, {user.name.split(" ")[0]}. Crea canciones originales y conviértelas en videoclips o anima tus ilustraciones y mangas desde un solo lugar.
          </p>
          <form action="/create" className="mt-7 flex max-w-2xl flex-col gap-2.5 sm:flex-row">
            <input name="prompt" required minLength={5} maxLength={1000} aria-label="Describe tu canción"
              placeholder="Describe tu próxima canción..."
              className="h-12 min-w-0 flex-1 rounded-xl border border-white/25 bg-white px-4 text-sm text-[#17203a] placeholder:text-[#65728a] shadow-lg focus:outline-none focus:ring-4 focus:ring-white/30"/>
            <Button type="submit" size="lg" className="shrink-0 border border-white/20 bg-white text-[#24388c] hover:bg-[#eef1ff]">
              <WandSparkles className="h-4 w-4"/>Crear música
            </Button>
          </form>
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/create" className="group studio-surface flex items-center gap-4 rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-brand/50">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand"><Music2 className="h-6 w-6"/></span>
          <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold">Crear música</span><span className="mt-1 block text-xs leading-relaxed text-muted">Letras, voces e instrumentales con ACE-Step.</span></span>
          <ArrowRight className="h-5 w-5 shrink-0 text-brand transition group-hover:translate-x-1"/>
        </Link>
        <Link href="/videos" className="group studio-surface flex items-center gap-4 rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-brand/50">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-2/10 text-brand-2"><Clapperboard className="h-6 w-6"/></span>
          <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold">Crear videos</span><span className="mt-1 block text-xs leading-relaxed text-muted"><ImagePlus className="mr-1 inline h-3 w-3"/>Imágenes, manga y videoclips con sonido.</span></span>
          <ArrowRight className="h-5 w-5 shrink-0 text-brand-2 transition group-hover:translate-x-1"/>
        </Link>
      </div>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="font-display text-xl font-bold">Tu música reciente</h2><p className="mt-0.5 text-xs text-muted">Vuelve a escuchar y crear nuevas versiones.</p></div>
            <Link href="/library" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand hover:underline">Ver biblioteca <ArrowRight className="h-4 w-4"/></Link>
          </div>
          <SongList scope="mine" compact limit={6} emptyTitle="Tu biblioteca está esperando" emptyText="Crea una canción y aparecerá aquí."/>
        </section>
        <aside className="space-y-3">
          <h2 className="font-display text-xl font-bold">Estado del motor</h2>
          <StatusCard/>
          <p className="px-1 text-xs leading-relaxed text-muted">El audio se genera con modelos abiertos en tu equipo cuando ComfyUI está conectado. Los videos se procesan localmente y se guardan en tu biblioteca.</p>
        </aside>
      </div>
    </div>
  );
}
