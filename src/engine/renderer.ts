// Orquesta las capas de dibujo: cielo y horizonte lejano, ciudad isométrica (con tu edificio y la
// habitación en su sitio del orden de pintor), nieve, luz, partículas y viñeta.
import { boxHull, p, pointInPolygon, toWorld, type P2 } from './iso';
import type { ObjectId } from '../game/state';
import { ANCHORS, orderedObjects, SCENE_OBJECTS, type SceneEnv, type TowerInfo } from '../scene/objects';
import { drawFloor, drawWalls, SLAB, WALL_T, ROOM_SIZE } from '../scene/room';
import { City, type IsoRect } from '../scene/city';
import { Skyline } from '../scene/skyline';
import { DEFAULT_WEEKS, drawFloorHighlight, drawTower, drawTowerToday, floorHulls, streetZ } from '../scene/tower';
import { computeLights, drawLampCone, Lighting, makeVignette, type Light, type LightFrame } from '../scene/lighting';
import type { RGB } from './color';
import { getAmbient } from '../scene/palette';
import { Particles, Snow } from './particles';

export interface View {
  w: number; // px CSS
  h: number;
  dpr: number;
  scale: number; // px CSS por px isométrico
  ox: number; // origen del mundo (esquina trasera del cuarto) en px CSS
  oy: number;
}

/**
 * Encuadre: la habitación arriba y su edificio hasta la calle, centrados entre el HUD y el dock.
 * Recuadro en px isométricos: x ∈ [−300, 300], y desde lo alto de las paredes hasta la acera de delante.
 */
export function computeView(w: number, h: number, dpr: number, weeks = DEFAULT_WEEKS): View {
  const narrow = w <= 760;
  const top = narrow ? 124 : 64; // HUD (en móvil ocupa tres filas)
  const bottom = narrow ? 64 : 76; // dock de pilares
  const availH = Math.max(200, h - top - bottom);
  const frameTop = -150;
  const frameBottom = 256 - streetZ(weeks) * 32 + 64;
  const frameH = frameBottom - frameTop;
  const scale = Math.max(0.42, Math.min(2.2, Math.min((availH * 0.97) / frameH, (w * 0.95) / 600)));
  const ox = w / 2;
  const oy = top + (availH - frameH * scale) / 2 - frameTop * scale;
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

let floorCache: { weeks: number; hulls: P2[][] } | null = null;

/** Planta del edificio (semana, 0 = la primera) bajo el punto, o null. */
export function pickFloor(view: View, weeks: number, x: number, y: number): number | null {
  if (!weeks) return null;
  if (!floorCache || floorCache.weeks !== weeks) floorCache = { weeks, hulls: floorHulls(weeks) };
  const { ix, iy } = screenToIso(view, x, y);
  for (let k = weeks - 1; k >= 0; k--) if (pointInPolygon(ix, iy, floorCache.hulls[k])) return k;
  return null;
}

export function hullFor(target: ObjectId): P2[] {
  const o = SCENE_OBJECTS.find((s) => s.target === target)!;
  return hullOf(o.id);
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

// ---------------------------------------------------------------------------
// Renderer

export const SNOW_BY_PHASE: Record<1 | 2 | 3, number> = { 1: 120, 2: 175, 3: 230 };

/** Extensión del diorama en px isométricos y posición del origen del mundo dentro de ella. */
const ROOM_BOX = { w: 560, h: 400, ox: 280, oy: 112 };

export interface PointerLike { nx: number; ny: number; inside: boolean; isTouch: boolean }

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  view: View;
  readonly skyline = new Skyline();
  readonly city = new City();
  readonly snow = new Snow();
  readonly lighting = new Lighting();
  readonly particles = new Particles();
  /** Progreso del barrido de luz de subida de nivel (0..1) o null. */
  sweep: number | null = null;
  /** Planta del edificio bajo el ratón (para resaltarla). */
  hoveredFloor: number | null = null;
  private gustT = 0;
  private parallax = { x: 0, y: 0 };
  private moteTimer = 0;
  private steamTimer = 0;
  // Capa del cuarto iluminado (cuarto + multiply), cacheada y re-renderizada solo cuando hace falta.
  private room = document.createElement('canvas');
  private roomCtx = this.room.getContext('2d')!;
  private roomFrame: LightFrame = { w: 0, h: 0, ox: 0, oy: 0, scale: 1 };
  private roomSig = '';
  private roomAge = Infinity;
  // Edificio-historial (se repinta cuando cambia el historial)
  private tower: { canvas: HTMLCanvasElement; rect: IsoRect; sig: string } | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private frameCost = 1 / 60;
  private weeks = DEFAULT_WEEKS;
  private citySig = '';
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
    this.view = computeView(window.innerWidth, window.innerHeight, dpr, this.weeks);
    const { canvas, view } = this;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    this.skyline.resize(view.w, view.h, dpr);
    this.snow.resize(view.w, view.h);
    const s = view.scale;
    this.roomFrame = { w: Math.ceil(ROOM_BOX.w * s), h: Math.ceil(ROOM_BOX.h * s), ox: ROOM_BOX.ox * s, oy: ROOM_BOX.oy * s, scale: s };
    this.room.width = Math.ceil(this.roomFrame.w * dpr);
    this.room.height = Math.ceil(this.roomFrame.h * dpr);
    this.lighting.resize(this.roomFrame);
    this.roomSig = '';
    this.tower = null;
    this.citySig = '';
    this.baseOx = view.ox;
    this.shift = 0;
    this.vignette = makeVignette(view);
  }

  /** Zona visible en px isométricos (con margen para el desplazamiento del panel). */
  private visibleIso(): IsoRect {
    const v = this.view;
    const mx = 420;
    const x0 = (-this.baseOx - mx) / v.scale, x1 = (v.w - this.baseOx + mx) / v.scale;
    const y0 = (-v.oy - 30) / v.scale, y1 = (v.h - v.oy + 30) / v.scale;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private ensureCity(weeks: number, glow: number) {
    if (weeks !== this.weeks) {
      this.weeks = weeks;
      this.resize();
    }
    const sig = `${this.view.w}x${this.view.h}|${weeks}|${glow.toFixed(2)}`;
    if (sig === this.citySig) return;
    this.citySig = sig;
    this.city.build(streetZ(weeks), this.view.scale, this.view.dpr, this.visibleIso(), glow);
  }

  private ensureTower(info: TowerInfo) {
    const sig = info.weeks.map((w) => w.phase + w.lights.join('')).join('|') + this.view.scale;
    if (this.tower?.sig === sig) return;
    const weeks = Math.max(1, info.weeks.length || DEFAULT_WEEKS);
    const z0 = streetZ(weeks);
    const hull = boxHull({ x: -WALL_T - 0.2, y: -WALL_T - 0.2, z: z0, w: ROOM_SIZE + WALL_T + 0.5, d: ROOM_SIZE + WALL_T + 0.5, h: -SLAB - z0 + 0.1 });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of hull) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 30;
    const rect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    const k = this.view.scale * this.view.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil(rect.w * k);
    c.height = Math.ceil(rect.h * k);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
    drawTower(ctx, info);
    this.tower = { canvas: c, rect, sig };
  }

  /** Ráfaga de nieve y viento (transición de fase). */
  gust(seconds = 5) {
    this.gustT = seconds;
  }

  /** Celebración de subida de nivel: barrido de luz y chispas desde el centro del cuarto. */
  celebrate(reduced = false) {
    if (!reduced) this.sweep = 0;
    const [x, y] = this.toScreen(4, 4, 1.2);
    this.particles.burst(x, y, 60, '#ffd98a');
  }

  /** Ancho ocupado por un panel a la derecha (px CSS): desplaza el cuarto lo justo para no taparlo. */
  setRightInset(px: number) {
    const { view } = this;
    if (px <= 0 || view.w < 900) {
      this.shiftTarget = 0;
      return;
    }
    const half = 300 * view.scale;
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

  get towerWeeks() {
    return this.weeks;
  }

  private signature(env: SceneEnv) {
    const r = (v: number) => Math.round(v * 50);
    return [
      env.level, env.phase, env.bossDecor, env.timerRunning, env.journalToday, env.reducedMotion,
      env.goals.map((g) => `${g.done ? 1 : 0}${g.steps}`).join(''),
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
    const weeks = Math.max(1, env.tower.weeks.length || DEFAULT_WEEKS);
    this.ensureCity(weeks, Math.round(amb.cityGlow * 20) / 20);
    this.ensureTower(env.tower);

    this.shift += (this.shiftTarget - this.shift) * Math.min(1, dt * (env.reducedMotion ? 60 : 6));
    if (Math.abs(this.shiftTarget - this.shift) < 0.3) this.shift = this.shiftTarget;
    view.ox = this.baseOx - this.shift;

    // parallax mínimo solo en el horizonte lejano
    const want = env.reducedMotion || pointer.isTouch ? { x: 0, y: 0 } : { x: pointer.nx, y: pointer.ny };
    this.parallax.x += (want.x - this.parallax.x) * Math.min(1, dt * 3);
    this.parallax.y += (want.y - this.parallax.y) * Math.min(1, dt * 3);

    this.particles.reduced = env.reducedMotion;
    this.skyline.update(env.reducedMotion ? 0 : dt);
    this.city.update(env.reducedMotion ? dt * 0.35 : dt, env.hour);
    this.gustT = Math.max(0, this.gustT - dt);
    const gust = env.reducedMotion ? 0 : Math.sin(Math.min(1, this.gustT / 5) * Math.PI);
    this.snow.setIntensity(env.reducedMotion ? 45 : SNOW_BY_PHASE[env.phase] + 150 * gust);
    this.snow.update(dt, t, -8 + Math.sin(t * 0.13) * 10 - 70 * gust);

    setScreenTransform(ctx, view);
    ctx.globalCompositeOperation = 'source-over';
    this.skyline.draw(ctx, t, this.parallax.x * 0.5, this.parallax.y * 0.5, amb.cityGlow);

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

    // ciudad isométrica con tu edificio y la habitación en su sitio del orden de pintor
    this.city.draw(ctx, view, t, env.phase, () => {
      const tw = this.tower!;
      setScreenTransform(ctx, view);
      ctx.drawImage(tw.canvas, view.ox + tw.rect.x * view.scale, view.oy + tw.rect.y * view.scale, tw.rect.w * view.scale, tw.rect.h * view.scale);
      setWorldTransform(ctx, view);
      if (!env.reducedMotion) drawTowerToday(ctx, env.tower, t);
      if (this.hoveredFloor !== null) drawFloorHighlight(ctx, weeks, this.hoveredFloor);
      setScreenTransform(ctx, view);
      const f = this.roomFrame;
      ctx.drawImage(this.room, view.ox - f.ox, view.oy - f.oy, f.w, f.h);
    });
    setScreenTransform(ctx, view);
    this.snow.draw(ctx, 'back', amb.snow, false);

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
