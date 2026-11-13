"use client";
import { Compass, Heart, Home, Library, LogOut, Menu, Music2, Settings, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobsDock } from "@/components/JobsDock";
import { Player } from "@/components/Player";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toaster } from "@/components/Toaster";
import { cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useJobs } from "@/stores/jobs";
import { usePlayer } from "@/stores/player";

const NAV = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/create", label: "Crear música", icon: Sparkles },
  { href: "/explore", label: "Explorar", icon: Compass },
  { href: "/library", label: "Mi biblioteca", icon: Library },
  { href: "/favorites", label: "Favoritos", icon: Heart },
  { href: "/settings", label: "Configuración", icon: Settings },
];

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const open = menuPath === pathname;
  const connect = useJobs((s) => s.connect);
  const disconnect = useJobs((s) => s.disconnect);
  const jobs = useJobs((s) => s.jobs);
  const hasTrack = usePlayer((s) => s.index >= 0);
  const active = jobs.filter((j) => j.status === "pending" || j.status === "running").length;

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    usePlayer.getState().playQueue([]);
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1" aria-label="Principal">
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setMenuPath(null)}
            aria-current={on ? "page" : undefined}
            className={cx(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              on ? "bg-brand-gradient text-white glow" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
            {href === "/create" && active > 0 && (
              <span className={cx("ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold", on ? "bg-white/25" : "bg-brand text-white")}>{active}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-3 flex items-center gap-3 px-1">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <ThemeToggle />
      </div>
      <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg">
        <LogOut className="h-4 w-4" /> Cerrar sesión
      </button>
    </div>
  );

  const brand = (
    <Link href="/" onClick={() => setMenuPath(null)} className="mb-6 flex items-center gap-2.5 px-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-white glow"><Music2 className="h-5 w-5" /></span>
      <span className="font-display text-xl font-bold tracking-tight">Sonora</span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface p-4 lg:flex">
        {brand}
        {nav}
        {account}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setMenuPath(pathname)} aria-label="Abrir menú" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-surface-2"><Menu className="h-5 w-5" /></button>
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold"><Music2 className="h-5 w-5 text-brand" />Sonora</Link>
        <Link href="/create" aria-label="Crear música" className="relative grid h-9 w-9 place-items-center rounded-lg bg-brand-gradient text-white">
          <Sparkles className="h-4 w-4" />
          {active > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold">{active}</span>}
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setMenuPath(null)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface p-4 shadow-2xl">
            <button onClick={() => setMenuPath(null)} aria-label="Cerrar menú" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2"><X className="h-4 w-4" /></button>
            {brand}
            {nav}
            {account}
          </aside>
        </div>
      )}

      <main className={cx("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10", hasTrack ? "pb-40 lg:pb-32" : "pb-10")}>{children}</main>
      <JobsDock />
      <Player />
      <Toaster />
    </div>
  );
}
