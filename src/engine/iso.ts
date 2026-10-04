// Proyección isométrica 2:1 y primitivas de dibujo.
// Coordenadas de mundo: x → derecha-abajo, y → izquierda-abajo, z → arriba.
import { shade } from './color';

export const TW = 64, TH = 32, TZ = 32;

export function toScreen(x: number, y: number, z = 0, ox = 0, oy = 0) {
  return {
    sx: (x - y) * (TW / 2) + ox,
    sy: (x + y) * (TH / 2) - z * TZ + oy,
  };
}

// Inversa a z=0 (para picking del suelo)
export function toWorld(sx: number, sy: number, ox = 0, oy = 0) {
  const a = (sx - ox) / (TW / 2);
  const b = (sy - oy) / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export type P3 = [number, number, number];
export type P2 = [number, number];

export function p(x: number, y: number, z = 0): P2 {
  return [(x - y) * (TW / 2), (x + y) * (TH / 2) - z * TZ];
}

/** Traza un polígono de puntos 3D proyectados (sin rellenar). */
export function pathPoly(ctx: CanvasRenderingContext2D, pts: P3[]) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [sx, sy] = p(pts[i][0], pts[i][1], pts[i][2]);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

export function fillPoly(ctx: CanvasRenderingContext2D, pts: P3[], color: string) {
  pathPoly(ctx, pts);
  ctx.fillStyle = color;
  ctx.fill();
}

export interface BoxColors {
  top: string;
  left: string; // cara y+d (mira hacia abajo-izquierda)
  right: string; // cara x+w (mira hacia abajo-derecha)
}

const boxColorCache = new Map<string, BoxColors>();

/** Sombreado fijo de tres tonos: top = base, izquierda −25 %, derecha −45 %. */
export function boxColors(base: string): BoxColors {
  let c = boxColorCache.get(base);
  if (!c) {
    c = { top: base, left: shade(base, -0.25), right: shade(base, -0.45) };
    boxColorCache.set(base, c);
  }
  return c;
}

/**
 * Prisma con tres caras visibles (superior, izquierda y derecha).
 * (x, y, z) es la esquina trasera inferior; w a lo largo de x, d a lo largo de y, h altura.
 */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, z: number,
  w: number, d: number, h: number,
  colors: string | BoxColors,
) {
  const c = typeof colors === 'string' ? boxColors(colors) : colors;
  const z1 = z + h;
  // cara izquierda (y = y + d)
  fillPoly(ctx, [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z1], [x, y + d, z1]], c.left);
  // cara derecha (x = x + w)
  fillPoly(ctx, [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z1], [x + w, y, z1]], c.right);
  // cara superior
  fillPoly(ctx, [[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]], c.top);
}

/** Cilindro vertical aproximado (elipse superior + cuerpo). */
export function drawCylinder(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, z: number,
  r: number, h: number,
  base: string,
) {
  const [bx, by] = p(cx, cy, z);
  const [, ty] = p(cx, cy, z + h);
  const rx = r * (TW / 2) * Math.SQRT2; // un círculo de radio r en el suelo → elipse 2:1
  const ry = rx / 2;
  const grad = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  grad.addColorStop(0, shade(base, -0.2));
  grad.addColorStop(0.55, shade(base, -0.35));
  grad.addColorStop(1, shade(base, -0.55));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(bx - rx, ty);
  ctx.ellipse(bx, ty, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.ellipse(bx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Clave de profundidad para el algoritmo del pintor. */
export function depthKey(b: { x: number; y: number; z: number; w: number; d: number }) {
  return b.x + b.w + (b.y + b.d) + b.z * 0.01;
}

/** Proyecta las 8 esquinas de una caja y devuelve su envolvente convexa (polígono de hit). */
export function boxHull(b: { x: number; y: number; z: number; w: number; d: number; h: number }): P2[] {
  const pts: P2[] = [];
  for (const dx of [0, b.w]) for (const dy of [0, b.d]) for (const dz of [0, b.h]) {
    pts.push(p(b.x + dx, b.y + dy, b.z + dz));
  }
  return convexHull(pts);
}

export function convexHull(points: P2[]): P2[] {
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const pt of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function pointInPolygon(x: number, y: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
