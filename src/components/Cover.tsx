"use client";
import { useMemo } from "react";

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Portada generativa determinista a partir del identificador de la canción. */
export function Cover({ seed, className = "" }: { seed: string; className?: string }) {
  const art = useMemo(() => {
    const r = rng(seed);
    const h1 = Math.floor(r() * 360);
    const h2 = (h1 + 40 + Math.floor(r() * 120)) % 360;
    const circles = Array.from({ length: 5 }, () => ({
      cx: r() * 100,
      cy: r() * 100,
      r: 14 + r() * 38,
      o: 0.18 + r() * 0.35,
      h: r() > 0.5 ? h1 : h2,
    }));
    const bars = Array.from({ length: 18 }, (_, i) => ({ x: 4 + i * 5.3, h: 6 + r() * 34 }));
    return { h1, h2, circles, bars };
  }, [seed]);
  const id = `g${seed}`;
  return (
    <svg viewBox="0 0 100 100" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${art.h1} 80% 55%)`} />
          <stop offset="1" stopColor={`hsl(${art.h2} 85% 42%)`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id})`} />
      {art.circles.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill={`hsl(${c.h} 90% 70%)`} opacity={c.o} />
      ))}
      <g fill="white" opacity="0.55">
        {art.bars.map((b, i) => (
          <rect key={i} x={b.x} y={88 - b.h} width="2.4" height={b.h} rx="1.2" />
        ))}
      </g>
    </svg>
  );
}
