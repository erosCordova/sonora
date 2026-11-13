import { CreateStudio } from "@/components/CreateStudio";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Crear música — Sonora" };

export default async function Page({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const { prompt } = await searchParams;
  return (
    <>
      <PageHeader title="Crear música" subtitle="Describe la canción o ajusta cada detalle. Se genera audio real con el motor de IA conectado." />
      <CreateStudio initialPrompt={(prompt ?? "").slice(0, 1000)} />
    </>
  );
}
