// Utilidades de color (hex <-> rgb, sombreado, mezcla). Sin dependencias.

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function hexToRgb(hex: string): RGB {
  const hit = cache.get(hex);
  if (hit) return hit;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const rgb: RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  cache.set(hex, rgb);
  return rgb;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

export function rgba(c: string | RGB, a: number): string {
  const [r, g, b] = typeof c === 'string' ? hexToRgb(c) : c;
  return `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Oscurece (amount < 0) o aclara (amount > 0) un color. amount en [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amount < 0) {
    const k = 1 + amount;
    return rgbToHex([r * k, g * k, b * k]);
  }
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

export function mix(a: string | RGB, b: string | RGB, t: number): RGB {
  const A = typeof a === 'string' ? hexToRgb(a) : a;
  const B = typeof b === 'string' ? hexToRgb(b) : b;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

export function mixHex(a: string, b: string, t: number): string {
  return rgbToHex(mix(a, b, t));
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
