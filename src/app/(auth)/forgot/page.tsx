import { ForgotForm } from "@/components/AuthForms";

export const metadata = { title: "Recuperar contraseña — Sonora" };

export default function Page() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Recuperar acceso</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Te enviaremos un enlace para elegir una nueva contraseña.</p>
      <ForgotForm />
    </>
  );
}
