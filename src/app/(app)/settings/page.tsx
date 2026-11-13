import { SettingsPanel } from "@/components/SettingsPanel";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Configuración — Sonora" };

export default async function Page() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Configuración" subtitle="Perfil, apariencia, seguridad y estado del motor de IA." />
      <SettingsPanel user={{ name: user.name, email: user.email, bio: user.bio }} />
    </>
  );
}
