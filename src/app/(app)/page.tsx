import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { StatusCard } from "@/components/CreateStudio";
import { SongList } from "@/components/SongList";
import { Button } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Inicio — Sonora" };

export default async function Home() {
  const user = await requireUser();
  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white sm:p-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/15 blur-2xl" />
        <p className="text-sm font-medium text-white/80">Hola, {user.name.split(" ")[0]}</p>
        <h1 className="mt-1 max-w-xl font-display text-3xl font-bold leading-tight sm:text-4xl">¿Qué canción quieres escuchar hoy?</h1>
        <form action="/create" className="mt-6 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <input
            name="prompt"
            required
            minLength={5}
            maxLength={1000}
            placeholder="Balada pop con piano y voz femenina sobre un viaje de verano…"
            className="h-12 flex-1 rounded-xl border-0 bg-white/95 px-4 text-sm text-black placeholder:text-black/50 focus:outline-none focus:ring-4 focus:ring-white/40"
            aria-label="Describe tu canción"
          />
          <Button type="submit" size="lg" className="border-0 bg-black/85 text-white hover:bg-black"><Sparkles className="h-4 w-4" />Crear</Button>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Tus últimas canciones</h2>
            <Link href="/library" className="inline-flex items-center gap-1 text-sm font-medium text-brand">Ver biblioteca <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <SongList scope="mine" compact limit={6} emptyTitle="Aún no has creado canciones" emptyText="Describe tu primera canción arriba. Cada resultado se guarda automáticamente en tu biblioteca." />
        </section>
        <aside className="space-y-4">
          <h2 className="font-display text-xl font-bold">Motor de IA</h2>
          <StatusCard />
          <p className="text-xs leading-relaxed text-muted">
            Sonora genera audio real con modelos abiertos (ACE-Step 1.5, licencia MIT). Las canciones generadas por IA pueden tener un estatus de derechos de autor incierto según tu jurisdicción; no se garantiza que estén libres de reclamaciones.
          </p>
        </aside>
      </div>
    </div>
  );
}
