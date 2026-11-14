import { PageHeader } from "@/components/ui";
import { SongList } from "@/components/SongList";
import { VideoLibrary } from "@/components/VideoLibrary";

export const metadata = { title: "Mi biblioteca — Sonora" };

export default function Page() {
  return (
    <>
      <PageHeader title="Mi biblioteca" subtitle="Tus canciones y videos organizados en un mismo lugar, con reproducción y descarga." />
      <SongList scope="mine" emptyTitle="Tu biblioteca está vacía" emptyText="Las canciones que generes se guardarán aquí automáticamente." />
      <VideoLibrary />
    </>
  );
}
