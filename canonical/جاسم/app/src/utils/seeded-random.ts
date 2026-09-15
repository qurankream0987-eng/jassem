export function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }

  return () => {
    hash = ((hash * 16807) % 2147483647);
    return ((hash & 0x7fffffff) / 2147483647);
  };
}

export function seededColor(seed: string): string {
  const rng = seededRandom(seed);
  const hue = Math.floor(rng() * 360);
  const saturation = 60 + Math.floor(rng() * 20);
  const lightness = 45 + Math.floor(rng() * 15);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export function seededGradient(seed: string): string {
  const rng = seededRandom(seed);
  const hue1 = Math.floor(rng() * 360);
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 50%), hsl(${hue2}, 70%, 45%))`;
}
