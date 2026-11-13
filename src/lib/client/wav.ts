// Recorte de audio en el navegador: decodifica, corta y codifica WAV PCM 16 bits.
export async function trimToWav(url: string, start: number, end: number): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo descargar el audio original");
  const arr = await res.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(arr);
    const sr = buf.sampleRate;
    const from = Math.max(0, Math.floor(start * sr));
    const to = Math.min(buf.length, Math.floor(end * sr));
    if (to - from < sr) throw new Error("El recorte debe durar al menos 1 segundo");
    const ch = Math.min(2, buf.numberOfChannels);
    const frames = to - from;
    const out = new DataView(new ArrayBuffer(44 + frames * ch * 2));
    const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF");
    out.setUint32(4, 36 + frames * ch * 2, true);
    w(8, "WAVE");
    w(12, "fmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, ch, true);
    out.setUint32(24, sr, true);
    out.setUint32(28, sr * ch * 2, true);
    out.setUint16(32, ch * 2, true);
    out.setUint16(34, 16, true);
    w(36, "data");
    out.setUint32(40, frames * ch * 2, true);
    const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < ch; c++) {
        const v = Math.max(-1, Math.min(1, chans[c][from + i]));
        out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([out], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}
