import { redirect } from "next/navigation";
import { Clapperboard, Music2, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="studio-hero relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="studio-mosaic pointer-events-none absolute inset-y-0 right-0 w-3/4 opacity-30"/>
        <div className="relative flex items-center gap-3 font-display text-2xl font-bold">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/25 bg-white/15"><Music2 className="h-6 w-6"/></span>Sonora
        </div>
        <div className="relative max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold"><Sparkles className="h-3.5 w-3.5"/>Estudio creativo con IA</span>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.12] tracking-tight xl:text-6xl">Tu música.<br/>Tus imágenes.<br/><span className="text-[#d8d7ff]">Tus historias.</span></h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/80">Genera canciones originales y crea videoclips con tus fotografías, ilustraciones o capítulos de manga. Todo desde el mismo estudio.</p>
          <div className="mt-8 flex gap-3">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold"><Music2 className="h-4 w-4"/>Música</span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold"><Clapperboard className="h-4 w-4"/>Video</span>
          </div>
        </div>
        <p className="relative text-xs text-white/75">Herramientas abiertas con procesamiento local. Usa únicamente contenido que tengas derecho a adaptar.</p>
      </section>
      <main className="relative flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="absolute right-5 top-5"><ThemeToggle/></div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
