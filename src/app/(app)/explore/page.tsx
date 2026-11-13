import { PageHeader } from "@/components/ui";
import { SongList } from "@/components/SongList";

export const metadata = { title: "Explorar — Sonora" };

export default function Page() {
  return (
    <>
      <PageHeader title="Explorar" subtitle="Canciones que otros creadores han decidido publicar. Solo se muestran las que su autor marcó como públicas." />
      <SongList scope="public" emptyTitle="Todavía no hay canciones públicas" emptyText="Publica una de tus canciones desde su menú «Publicar en Explorar» y aparecerá aquí." />
    </>
  );
}
