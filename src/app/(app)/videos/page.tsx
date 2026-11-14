import { PageHeader } from "@/components/ui";
import { VideoStudio } from "@/components/VideoStudio";
export const metadata={title:"Crear videos — Sonora"};
export default function Page() {
  return <><PageHeader title="Crear videos" subtitle="Convierte imágenes, páginas de manga y tus canciones en MP4 con movimiento, voz y sonido. El montaje se procesa en tu PC." />
    <VideoStudio /></>;
}
