"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

function useSubmit(fn: () => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    loading,
    error,
    setError,
    onSubmit: async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
  };
}

const Err = ({ text }: { text: string | null }) => (text ? <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{text}</p> : null);

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const f = useSubmit(async () => {
    await api("/api/auth/login", { method: "POST", json: { email, password } });
    router.push("/");
    router.refresh();
  });
  return (
    <form onSubmit={f.onSubmit} className="space-y-4">
      <Field label="Correo"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Contraseña"><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Err text={f.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.loading}>Iniciar sesión</Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot" className="text-muted hover:text-fg">¿Olvidaste tu contraseña?</Link>
        <Link href="/register" className="font-medium text-brand">Crear cuenta</Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const f = useSubmit(async () => {
    await api("/api/auth/register", { method: "POST", json: { name, email, password } });
    router.push("/");
    router.refresh();
  });
  return (
    <form onSubmit={f.onSubmit} className="space-y-4">
      <Field label="Nombre"><Input required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Correo"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Contraseña" hint="mínimo 8 caracteres"><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Err text={f.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.loading}>Crear cuenta</Button>
      <p className="text-center text-sm text-muted">¿Ya tienes cuenta? <Link href="/login" className="font-medium text-brand">Inicia sesión</Link></p>
    </form>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<{ mail: boolean } | null>(null);
  const f = useSubmit(async () => {
    const r = await api<{ mailConfigured: boolean }>("/api/auth/forgot", { method: "POST", json: { email } });
    setDone({ mail: r.mailConfigured });
  });
  if (done)
    return (
      <div className="space-y-4 text-sm">
        <p className="rounded-xl bg-ok/10 px-3 py-3 text-ok">
          Si existe una cuenta con ese correo, se ha generado un enlace de recuperación válido durante 1 hora.
        </p>
        {!done.mail && (
          <p className="rounded-xl bg-warn/10 px-3 py-3 text-warn">
            Este servidor no tiene SMTP configurado (variable SMTP_URL), por lo que no se envió ningún correo. El administrador puede obtener el enlace en los logs del servidor.
          </p>
        )}
        <Link href="/login" className="font-medium text-brand">Volver a iniciar sesión</Link>
      </div>
    );
  return (
    <form onSubmit={f.onSubmit} className="space-y-4">
      <Field label="Correo de tu cuenta"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Err text={f.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.loading}>Enviar enlace</Button>
      <p className="text-center text-sm"><Link href="/login" className="text-muted hover:text-fg">Volver</Link></p>
    </form>
  );
}

export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const f = useSubmit(async () => {
    await api("/api/auth/reset", { method: "POST", json: { token, password } });
    router.push("/login");
  });
  if (!token) return <p className="text-sm text-bad">Falta el token del enlace. Solicita uno nuevo desde «¿Olvidaste tu contraseña?».</p>;
  return (
    <form onSubmit={f.onSubmit} className="space-y-4">
      <Field label="Nueva contraseña" hint="mínimo 8 caracteres"><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Err text={f.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={f.loading}>Cambiar contraseña</Button>
    </form>
  );
}
