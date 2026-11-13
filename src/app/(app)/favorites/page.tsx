import { PageHeader } from "@/components/ui";
import { SongList } from "@/components/SongList";

export const metadata = { title: "Favoritos — Sonora" };

export default function Page() {
  return (
    <>
      <PageHeader title="Favoritos" subtitle="Las canciones que marcaste con un corazón." />
      <SongList scope="mine" favoritesOnly emptyTitle="Sin favoritos todavía" emptyText="Pulsa el corazón de cualquier canción de tu biblioteca para guardarla aquí." />
    </>
  );
}
