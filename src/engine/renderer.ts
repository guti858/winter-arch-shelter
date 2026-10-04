// Orquesta las capas de dibujo.
import { boxHull, fillPoly, p, pointInPolygon, toWorld, type P2 } from './iso';
import type { ObjectId } from '../game/state';
import { ANCHORS, orderedObjects, SCENE_OBJECTS, type SceneEnv } from '../scene/objects';
import { drawFloor, drawShadow, drawWalls } from '../scene/room';
import { City } from '../scene/city';
import { computeLights, drawLampCone, Lighting, makeVignette, type Light, type LightFrame } from '../scene/lighting';
import type { RGB } from './color';
import { getAmbient } from '../scene/palette';
import { Particles, Snow } from './particles';

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
  const narrow = w <= 760;
  const top = narrow ? 124 : 64; // HUD (en móvil ocupa tres filas)
  const bottom = narrow ? 64 : 76; // dock de pilares
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

// ---------------------------------------------------------------------------
// Renderer: compone ciudad, nieve, cuarto, luz, partículas y viñeta.

export const SNOW_BY_PHASE: Record<1 | 2 | 3, number> = { 1: 120, 2: 175, 3: 230 };

/** Extensión del diorama en px isométricos y posición del origen del mundo dentro de ella. */
const ROOM_BOX = { w: 560, h: 400, ox: 280, oy: 112 };

export interface PointerLike { nx: number; ny: number; inside: boolean; isTouch: boolean }

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  view: View;
  readonly city = new City();
  readonly snow = new Snow();
  readonly lighting = new Lighting();
  readonly particles = new Particles();
  /** Progreso del barrido de luz de subida de nivel (0..1) o null. */
  sweep: number | null = null;
  private parallax = { x: 0, y: 0 };
  private moteTimer = 0;
  private steamTimer = 0;
  // Capa del cuarto iluminado (cuarto + multiply), cacheada y re-renderizada solo cuando hace falta.
  private room = document.createElement('canvas');
  private roomCtx = this.room.getContext('2d')!;
  private roomFrame: LightFrame = { w: 0, h: 0, ox: 0, oy: 0, scale: 1 };
  private roomSig = '';
  private roomAge = Infinity;
  private backdrop = document.createElement('canvas');
  private vignette: HTMLCanvasElement | null = null;
  /** Media móvil del tiempo de frame: si el equipo va justo, el cuarto se refresca a 20 Hz. */
  private frameCost = 1 / 60;
  /** Desplazamiento horizontal del diorama para dejar sitio al panel lateral. */
  private baseOx = 0;
  private shift = 0;
  private shiftTarget = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.view = computeView(innerWidth, innerHeight, 1);
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view = computeView(window.innerWidth, window.innerHeight, dpr);
    const { canvas, view } = this;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    this.city.resize(view.w, view.h, dpr);
    this.snow.resize(view.w, view.h);
    const s = view.scale;
    this.roomFrame = { w: Math.ceil(ROOM_BOX.w * s), h: Math.ceil(ROOM_BOX.h * s), ox: ROOM_BOX.ox * s, oy: ROOM_BOX.oy * s, scale: s };
    this.room.width = Math.ceil(this.roomFrame.w * dpr);
    this.room.height = Math.ceil(this.roomFrame.h * dpr);
    this.lighting.resize(this.roomFrame);
    this.roomSig = '';
    this.baseOx = view.ox;
    this.shift = 0;
    this.buildBackdrop();
    this.vignette = makeVignette(view);
  }

  /** Halo oscuro tras el diorama (lo separa de la ciudad) + sombra flotante. Estático. */
  private buildBackdrop() {
    const { view } = this;
    const c = this.backdrop;
    c.width = Math.ceil(view.w * view.dpr);
    c.height = Math.ceil(view.h * view.dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const [cx, cy] = this.toScreen(4, 4, 1.2);
    const r = 330 * view.scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.78);
    const g = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r);
    g.addColorStop(0, 'rgba(8,8,26,0.5)');
    g.addColorStop(0.6, 'rgba(8,8,26,0.28)');
    g.addColorStop(1, 'rgba(8,8,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    setWorldTransform(ctx, view);
    drawShadow(ctx);
  }

  /** Ancho ocupado por un panel a la derecha (px CSS): desplaza el cuarto lo justo para no taparlo. */
  setRightInset(px: number) {
    const { view } = this;
    if (px <= 0 || view.w < 900) {
      this.shiftTarget = 0;
      return;
    }
    const half = (ROOM_BOX.w / 2) * view.scale;
    const need = this.baseOx + half - (view.w - px - 12);
    const room = this.baseOx - half - 8;
    this.shiftTarget = Math.max(0, Math.min(need, room));
  }

  toScreen(x: number, y: number, z: number): P2 {
    return worldToScreen(this.view, x, y, z);
  }

  anchorOf(id: ObjectId): P2 {
    const [x, y, z] = ANCHORS[id];
    return this.toScreen(x, y, z);
  }

  private signature(env: SceneEnv) {
    const r = (v: number) => Math.round(v * 50);
    return [
      env.level, env.phase, env.bossDecor, env.timerRunning, env.journalToday, env.reducedMotion,
      env.goals.map((g) => (g.done ? 1 : 0)).join(''),
      Object.values(env.glow).map(r).join(','),
      Object.values(env.meters).map(r).join(','),
    ].join('|');
  }

  private renderRoom(env: SceneEnv, lights: Light[], ambient: RGB) {
    const ctx = this.roomCtx, f = this.roomFrame, dpr = this.view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.room.width, this.room.height);
    const k = dpr * f.scale;
    ctx.setTransform(k, 0, 0, k, f.ox * dpr, f.oy * dpr);
    drawFloor(ctx);
    drawWalls(ctx);
    for (const o of orderedObjects(env)) o.draw(ctx, env);
    this.lighting.render(f, ambient, lights, this.sweep);
    this.lighting.apply(ctx, f, dpr);
  }

  frame(env: SceneEnv, dt: number, pointer: PointerLike, hovered: ObjectId | null) {
    const { ctx, view } = this;
    const t = env.t;
    const amb = getAmbient(env.level, env.phase);
    this.frameCost += (dt - this.frameCost) * 0.05;
    this.shift += (this.shiftTarget - this.shift) * Math.min(1, dt * (env.reducedMotion ? 60 : 6));
    if (Math.abs(this.shiftTarget - this.shift) < 0.3) this.shift = this.shiftTarget;
    view.ox = this.baseOx - this.shift;

    // parallax suave según el ratón (0 en táctil o con movimiento reducido)
    const want = env.reducedMotion || pointer.isTouch ? { x: 0, y: 0 } : { x: pointer.nx, y: pointer.ny };
    this.parallax.x += (want.x - this.parallax.x) * Math.min(1, dt * 3);
    this.parallax.y += (want.y - this.parallax.y) * Math.min(1, dt * 3);

    this.city.update(dt);
    this.snow.setIntensity(env.reducedMotion ? 45 : SNOW_BY_PHASE[env.phase]);
    this.snow.update(dt, t, -8 + Math.sin(t * 0.13) * 10);

    setScreenTransform(ctx, view);
    ctx.globalCompositeOperation = 'source-over';
    this.city.draw(ctx, t, this.parallax.x, this.parallax.y, amb.cityGlow);
    this.snow.draw(ctx, 'back', amb.snow, false);
    ctx.drawImage(this.backdrop, -this.shift, 0, view.w, view.h);

    // cuarto iluminado (cacheado)
    const lights = computeLights(env, amb);
    const sig = this.signature(env);
    const animating = this.sweep !== null || Object.values(env.flash).some((v) => (v ?? 0) > 0);
    const interval = env.reducedMotion ? Infinity : this.frameCost > 0.022 ? 1 / 20 : 0;
    this.roomAge += dt;
    if (sig !== this.roomSig || animating || this.roomAge >= interval) {
      this.renderRoom(env, lights, amb.ambient);
      this.roomSig = sig;
      this.roomAge = 0;
    }
    const f = this.roomFrame;
    ctx.drawImage(this.room, view.ox - f.ox, view.oy - f.oy, f.w, f.h);

    const lampOn = env.level >= 2 ? (0.55 + 0.45 * env.glow.desk) * amb.warmBoost : 0;
    drawLampCone(ctx, view, lampOn);
    this.lighting.bloom(ctx, view, lights, t);

    // polvo en el cono del flexo y vapor de la taza
    if (lampOn > 0 && !env.reducedMotion) {
      this.moteTimer -= dt;
      if (this.moteTimer <= 0 && this.particles.count('mote') < 14) {
        this.moteTimer = 0.35;
        const u = Math.random(), v = Math.random();
        const [sx, sy] = this.toScreen(6.5 + u * 0.7, 0.5 + v * 0.5, 0.9 + Math.random() * 0.45);
        this.particles.mote(sx, sy);
      }
    }
    if (env.level >= 8 && !env.reducedMotion) {
      this.steamTimer -= dt;
      if (this.steamTimer <= 0) {
        this.steamTimer = 0.28;
        const [sx, sy] = this.toScreen(3.9, 3.55, 0.6);
        this.particles.steam(sx, sy);
      }
    }

    if (hovered) drawHover(ctx, view, hovered, t);

    setScreenTransform(ctx, view);
    this.particles.update(dt);
    this.particles.draw(ctx, view.scale);
    this.snow.draw(ctx, 'front', amb.snow, env.level >= 10);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, view.w, view.h);
  }
}
