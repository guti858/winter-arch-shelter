// Orquesta las capas de dibujo.
import { fillPoly, p, toWorld } from './iso';

export const ROOM = 8; // tiles por lado

export interface View {
  w: number; // px CSS
  h: number;
  dpr: number;
  scale: number; // px CSS por px isométrico
  ox: number; // origen del mundo (esquina trasera del cuarto) en px CSS
  oy: number;
}

export function computeView(w: number, h: number, dpr: number): View {
  const top = 64; // HUD
  const bottom = 76; // dock de pilares
  const availH = Math.max(200, h - top - bottom);
  // Extensión del diorama en px isométricos: ancho ≈ 540, alto ≈ 400 (paredes + suelo + losa)
  const scale = Math.max(0.45, Math.min(2.4, Math.min((availH * 0.86) / 400, (w * 0.92) / 560)));
  const ox = w / 2;
  const oy = top + availH / 2 - 90 * scale;
  return { w, h, dpr, scale, ox, oy };
}

/** px CSS → px isométricos (relativos al origen del mundo). */
export function screenToIso(view: View, x: number, y: number) {
  return { ix: (x - view.ox) / view.scale, iy: (y - view.oy) / view.scale };
}

export function screenToTile(view: View, x: number, y: number) {
  const { ix, iy } = screenToIso(view, x, y);
  return toWorld(ix, iy);
}

/** Aplica la transformación del mundo al contexto. */
export function setWorldTransform(ctx: CanvasRenderingContext2D, view: View) {
  const k = view.dpr * view.scale;
  ctx.setTransform(k, 0, 0, k, view.ox * view.dpr, view.oy * view.dpr);
}

export function setScreenTransform(ctx: CanvasRenderingContext2D, view: View) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}

/** Rejilla de depuración (hito 0). */
export function drawDebugGrid(ctx: CanvasRenderingContext2D, view: View, hover: { x: number; y: number } | null) {
  setWorldTransform(ctx, view);
  for (let x = 0; x < ROOM; x++) {
    for (let y = 0; y < ROOM; y++) {
      const isHover = hover && Math.floor(hover.x) === x && Math.floor(hover.y) === y;
      fillPoly(ctx, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]],
        isHover ? '#ffb347' : (x + y) % 2 ? '#1d2550' : '#232c5e');
    }
  }
  ctx.strokeStyle = 'rgba(127,214,255,0.35)';
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  for (let i = 0; i <= ROOM; i++) {
    const a = p(i, 0), b = p(i, ROOM), c = p(0, i), d = p(ROOM, i);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
  }
  ctx.stroke();
}
