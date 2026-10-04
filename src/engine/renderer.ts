// Orquesta las capas de dibujo.
import { boxHull, fillPoly, p, pointInPolygon, toWorld, type P2 } from './iso';
import type { ObjectId } from '../game/state';
import { orderedObjects, SCENE_OBJECTS, type SceneEnv } from '../scene/objects';
import { drawFloor, drawShadow, drawWalls } from '../scene/room';

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

/** Mundo → px CSS. */
export function worldToScreen(view: View, x: number, y: number, z: number): P2 {
  const [ix, iy] = p(x, y, z);
  return [view.ox + ix * view.scale, view.oy + iy * view.scale];
}

/** Aplica la transformación del mundo al contexto. */
export function setWorldTransform(ctx: CanvasRenderingContext2D, view: View) {
  const k = view.dpr * view.scale;
  ctx.setTransform(k, 0, 0, k, view.ox * view.dpr, view.oy * view.dpr);
}

export function setScreenTransform(ctx: CanvasRenderingContext2D, view: View) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}

// ---------------------------------------------------------------------------
// Picking

const HULLS = new Map<string, P2[]>();
function hullOf(id: string): P2[] {
  let h = HULLS.get(id);
  if (!h) {
    const o = SCENE_OBJECTS.find((s) => s.id === id)!;
    h = boxHull(o.box);
    HULLS.set(id, h);
  }
  return h;
}

/** Objeto clicable bajo el punto (px CSS), probando de delante hacia atrás. */
export function pick(view: View, env: SceneEnv, x: number, y: number): ObjectId | null {
  const { ix, iy } = screenToIso(view, x, y);
  const ordered = orderedObjects(env).filter((o) => o.target);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const o = ordered[i];
    if (pointInPolygon(ix, iy, hullOf(o.id))) return o.target!;
  }
  return null;
}

export function hullFor(target: ObjectId): P2[] {
  const o = SCENE_OBJECTS.find((s) => s.target === target)!;
  return hullOf(o.id);
}

// ---------------------------------------------------------------------------
// Dibujo del cuarto

export function drawRoom(ctx: CanvasRenderingContext2D, view: View, env: SceneEnv) {
  setWorldTransform(ctx, view);
  drawShadow(ctx);
  drawFloor(ctx);
  drawWalls(ctx);
  for (const o of orderedObjects(env)) o.draw(ctx, env);
}

export function drawHover(ctx: CanvasRenderingContext2D, view: View, target: ObjectId, t: number) {
  setWorldTransform(ctx, view);
  const hull = hullFor(target);
  ctx.save();
  ctx.beginPath();
  hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const pulse = 0.6 + 0.4 * Math.sin(t * 4);
  ctx.shadowColor = 'rgba(255,200,120,0.9)';
  ctx.shadowBlur = 12 * view.scale * view.dpr;
  ctx.strokeStyle = `rgba(255,217,138,${0.55 + pulse * 0.35})`;
  ctx.lineWidth = 1.6 / Math.max(0.6, view.scale);
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -t * 12;
  ctx.stroke();
  ctx.restore();
}

/** Rejilla de depuración (hito 0). */
export function drawDebugGrid(ctx: CanvasRenderingContext2D, view: View, hover: { x: number; y: number } | null) {
  setWorldTransform(ctx, view);
  for (let x = 0; x < ROOM; x++) {
    for (let y = 0; y < ROOM; y++) {
      const isHover = hover && Math.floor(hover.x) === x && Math.floor(hover.y) === y;
      if (!isHover) continue;
      fillPoly(ctx, [[x, y, 0.01], [x + 1, y, 0.01], [x + 1, y + 1, 0.01], [x, y + 1, 0.01]], 'rgba(255,179,71,0.35)');
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
