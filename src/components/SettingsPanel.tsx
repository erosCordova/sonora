"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "@/components/ThemeToggle";
import { Button, Card, Chip, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useJobs } from "@/stores/jobs";
import { toast } from "@/stores/toast";

export function SettingsPanel({ user }: { user: { name: string; email: string; bio: string } }) {
  const router = useRouter();
  const { dark, set } = useTheme();
  const system = useJobs((s) => s.system);
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio);
  const [saving, setSaving] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);

  async function run(fn: () => Promise<void>, setBusy: (b: boolean) => void) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <h2 className="mb-4 font-display font-bold">Perfil</h2>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/profile", { method: "PATCH", json: { name, bio } }); toast.success("Perfil actualizado"); router.refresh(); }, setSaving); }}>
          <Field label="Correo"><Input value={user.email} disabled /></Field>
          <Field label="Nombre"><Input value={name} minLength={2} maxLength={80} required onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Biografía" hint={`${bio.length}/300`}><Textarea rows={3} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
          <Button type="submit" variant="primary" loading={saving}>Guardar cambios</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 font-display font-bold">Apariencia</h2>
        <div className="flex flex-wrap gap-2">
          <Chip active={!dark} onClick={() => set(false)}><Sun className="mr-1 inline h-3.5 w-3.5" />Claro</Chip>
          <Chip active={dark} onClick={() => set(true)}><Moon className="mr-1 inline h-3.5 w-3.5" />Oscuro</Chip>
          <Chip onClick={() => { localStorage.removeItem("theme"); set(window.matchMedia("(prefers-color-scheme: dark)").matches); localStorage.removeItem("theme"); }}><Monitor className="mr-1 inline h-3.5 w-3.5" />Seguir al sistema</Chip>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-display font-bold">Contraseña</h2>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/profile/password", { method: "POST", json: { current: cur, next } }); toast.success("Contraseña cambiada; las demás sesiones se cerraron"); setCur(""); setNext(""); }, setPwBusy); }}>
          <Field label="Contraseña actual"><Input type="password" required autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="Nueva contraseña" hint="mínimo 8 caracteres"><Input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Button type="submit" loading={pwBusy}>Cambiar contraseña</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-display font-bold">Motor de IA</h2>
        {system ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Motor musical</dt><dd>{system.engine}</dd>
            <dt className="text-muted">Motor musical</dt><dd>{system.workerOnline ? "Disponible" : "Desconectado"}</dd>
            <dt className="text-muted">Cola</dt><dd>{system.queued} pendientes · {system.running} en ejecución</dd>
            <dt className="text-muted">Modelo de letras</dt><dd>{system.llm.configured ? system.llm.model : "No configurado"}</dd>
          </dl>
        ) : <p className="text-sm text-muted">Cargando estado…</p>}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          ACE-Step 1.5 (MIT). No se permite la clonación de voces de personas reales: el sistema solo genera voces sintéticas a partir de descripciones. Las obras generadas por IA pueden tener un régimen de derechos incierto; no pidas imitar canciones o artistas concretos.
        </p>
      </Card>

      <Card className="border-bad/30">
        <h2 className="mb-2 font-display font-bold text-bad">Eliminar cuenta</h2>
        <p className="mb-4 text-sm text-muted">Se borrarán tu perfil, todas tus canciones y sus archivos de audio. No se puede deshacer.</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (!confirm("¿Eliminar la cuenta y todas tus canciones definitivamente?")) return; void run(async () => { await api("/api/profile", { method: "DELETE", json: { password: delPw } }); router.push("/login"); router.refresh(); }, setDelBusy); }}>
          <Field label="Confirma con tu contraseña" className="min-w-56 flex-1"><Input type="password" required value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" /></Field>
          <Button type="submit" variant="danger" loading={delBusy}>Eliminar cuenta</Button>
        </form>
      </Card>
    </div>
  );
}
