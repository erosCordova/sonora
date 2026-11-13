import { Suspense } from "react";
import { ResetForm } from "@/components/AuthForms";

export const metadata = { title: "Nueva contraseña — Sonora" };

export default function Page() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold">Nueva contraseña</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Elige una contraseña segura.</p>
      <Suspense><ResetForm /></Suspense>
    </>
  );
}
