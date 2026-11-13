import { LoginForm } from "@/components/AuthForms";

export const metadata = { title: "Iniciar sesión — Sonora" };

export default function Page() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Bienvenido de nuevo</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Accede a tu biblioteca musical.</p>
      <LoginForm />
    </>
  );
}
