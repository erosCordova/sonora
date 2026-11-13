import { RegisterForm } from "@/components/AuthForms";

export const metadata = { title: "Crear cuenta — Sonora" };

export default function Page() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Crea tu cuenta</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Tu biblioteca será privada y persistente.</p>
      <RegisterForm />
    </>
  );
}
