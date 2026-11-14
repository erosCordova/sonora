import { PageHeader } from "@/components/ui";
import { SongList } from "@/components/SongList";
import { VideoLibrary } from "@/components/VideoLibrary";

export const metadata = { title: "Mi biblioteca — Sonora" };

export default function Page() {
  return (
    <>
      <PageHeader title="Mi biblioteca" subtitle="Tus canciones privadas, con historial de versiones y descargas. Persisten al cerrar sesión." />
      <SongList scope="mine" emptyTitle="Tu biblioteca está vacía" emptyText="Las canciones que generes se guardarán aquí automáticamente." />
      <VideoLibrary />
    </>
  );
}
