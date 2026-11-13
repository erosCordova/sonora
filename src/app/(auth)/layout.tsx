import { redirect } from "next/navigation";
import { Music2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-gradient p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5 font-display text-2xl font-bold"><Music2 className="h-7 w-7" />Sonora</div>
        <div>
          <p className="font-display text-4xl font-bold leading-tight">Describe una canción.<br />Escúchala nacer.</p>
          <p className="mt-4 max-w-md text-white/80">Música original con voces e instrumentos, generada por modelos abiertos de IA y guardada en tu biblioteca privada.</p>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 h-96 w-96 rounded-full bg-black/15 blur-3xl" />
        <p className="relative text-xs text-white/70">Los resultados son generados por IA; revisa los derechos antes de usarlos comercialmente.</p>
      </div>
      <div className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
