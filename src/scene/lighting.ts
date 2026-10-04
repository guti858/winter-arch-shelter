// Luz ambiental (multiply), focos cálidos (lighter), halos (bloom) y viñeta.
import { p, pathPoly } from '../engine/iso';
import { rgba, type RGB } from '../engine/color';
import type { View } from '../engine/renderer';
import type { ObjectId } from '../game/state';
import { ANCHORS, type SceneEnv } from './objects';
import { pathSilhouette, windowHole, WINDOW } from './room';
import type { Ambient } from './palette';

export interface Light {
  x: number; y: number; z: number; // mundo
  r: number; // radio en px isométricos
  color: RGB;
  intensity: number;
  /** Radio del halo (bloom) en px isométricos; 0 = sin halo. */
  bloom?: number;
  bloomAt?: [number, number, number];
  /** Charco de luz achatado (sobre el suelo/superficies). */
  flat?: boolean;
}

const COLD: RGB = [120, 160, 255];
const SCREEN: RGB = [95, 168, 255];
const WHITE_WARM: RGB = [255, 236, 200];

/** Calcula las luces de la escena a partir del estado. La luz cálida es la métrica visual del progreso. */
export function computeLights(env: SceneEnv, amb: Ambient): Light[] {
  const L: Light[] = [];
  const warm = amb.warm;
  const boost = amb.warmBoost;
  const lvl = env.level;
  const flash = (id: ObjectId) => env.flash[id] ?? 0;

  // Lámpara de la mesilla: "una sola luz tenue" al principio, cálida desde el nivel 8
  const bedLamp = lvl >= 8 ? 0.95 : 0.32 + env.glow.bed * 0.25;
  L.push({ x: 0.45, y: 5.4, z: 0.9, r: lvl >= 8 ? 210 : 120, color: warm, intensity: bedLamp * boost, bloom: lvl >= 8 ? 34 : 16, bloomAt: [0.33, 5.25, 0.86] });

  // Monitor (frío, siempre)
  L.push({ x: 6.4, y: 0.7, z: 1.1, r: 95, color: SCREEN, intensity: 0.42, bloom: 22, bloomAt: [6.4, 0.2, 1.35] });

  // Ventana: luz fría de la ciudad que entra + resplandor cálido desde el nivel 3
  L.push({ x: (WINDOW.x0 + WINDOW.x1) / 2, y: 1.6, z: 0, r: 190, color: COLD, intensity: 0.32, flat: true });
  if (lvl >= 3) L.push({ x: 3.1, y: 0.3, z: 2.4, r: 95, color: warm, intensity: 0.35 * boost, bloom: 14, bloomAt: [WINDOW.x1 - 0.37, 0.1, WINDOW.z0 + 0.12] });

  // Flexo del escritorio (nivel 2+)
  if (lvl >= 2) {
    const k = (0.55 + 0.45 * env.glow.desk) * boost;
    L.push({ x: 6.75, y: 0.75, z: 0.8, r: 150, color: warm, intensity: 0.95 * k, flat: true, bloom: 26, bloomAt: [7.18, 0.62, 1.38] });
    L.push({ x: 6.6, y: 1.6, z: 0, r: 120, color: warm, intensity: 0.3 * k, flat: true });
  }

  // Cocina / nevera (nivel 5+)
  if (lvl >= 5) {
    L.push({ x: 8.1, y: 3.4, z: 0.6, r: 130, color: WHITE_WARM, intensity: 0.55 * boost, bloom: 16, bloomAt: [8.0, 3.4, 0.88] });
  }

  // Guirnalda (nivel 6+)
  if (lvl >= 6) {
    for (let i = 0; i < 5; i++) {
      L.push({ x: 0.8 + i * 1.6, y: 0.3, z: 2.6, r: 80, color: warm, intensity: 0.22 * boost });
      L.push({ x: 0.3, y: 0.8 + i * 1.6, z: 2.6, r: 80, color: warm, intensity: 0.22 * boost });
    }
  }

  // Auras por objeto: medidor de luz de cada pilar + destello de recompensa
  (Object.keys(ANCHORS) as ObjectId[]).forEach((id) => {
    const g = env.glow[id] ?? 0;
    const f = flash(id);
    const k = g * 0.5 + f * 0.9;
    if (k <= 0.01) return;
    const [x, y, z] = ANCHORS[id];
    L.push({ x, y, z, r: 70 + 55 * g + 50 * f, color: warm, intensity: k * boost, bloom: f > 0.05 ? 30 * f : 0 });
  });

  return L;
}

/** Lienzo destino del mapa de luz: tamaño en px CSS y origen del mundo dentro de él. */
export interface LightFrame { w: number; h: number; ox: number; oy: number; scale: number }

export class Lighting {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  /** Resolución del mapa de luz respecto a px CSS (la luz es suave: media resolución basta). */
  private res = 0.5;

  resize(frame: LightFrame) {
    this.canvas.width = Math.ceil(frame.w * this.res);
    this.canvas.height = Math.ceil(frame.h * this.res);
  }

  render(frame: LightFrame, ambient: RGB, lights: Light[], sweep: number | null) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.res;
    ctx.setTransform(frame.scale * k, 0, 0, frame.scale * k, frame.ox * k, frame.oy * k);
    ctx.save();
    pathSilhouette(ctx);
    ctx.clip();
    ctx.fillStyle = rgba(ambient, 1);
    pathSilhouette(ctx);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (l.intensity <= 0) continue;
      const [cx, cy] = p(l.x, l.y, l.z);
      const c: RGB = [l.color[0] * l.intensity, l.color[1] * l.intensity, l.color[2] * l.intensity];
      ctx.save();
      ctx.translate(cx, cy);
      if (l.flat) ctx.scale(1, 0.55);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, l.r);
      g.addColorStop(0, rgba(c, 1));
      g.addColorStop(0.35, rgba([c[0] * 0.55, c[1] * 0.55, c[2] * 0.55], 1));
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, l.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // barrido de luz al subir de nivel
    if (sweep !== null) {
      const x = -320 + sweep * 640;
      const g = ctx.createLinearGradient(x - 90, 0, x + 90, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.5, 'rgba(255,214,150,1)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 90, -200, 180, 600);
    }
    ctx.restore();
    // el hueco de la ventana deja ver la ciudad sin oscurecer
    ctx.globalCompositeOperation = 'destination-out';
    pathPoly(ctx, windowHole());
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Multiplica el mapa de luz sobre el lienzo destino (cuyo transform se ignora). */
  apply(target: CanvasRenderingContext2D, frame: LightFrame, dpr: number) {
    target.save();
    target.setTransform(dpr, 0, 0, dpr, 0, 0);
    target.globalCompositeOperation = 'multiply';
    target.drawImage(this.canvas, 0, 0, frame.w, frame.h);
    target.restore();
  }

  /** Halos aditivos sobre las fuentes de luz (después del multiply). */
  bloom(main: CanvasRenderingContext2D, view: View, lights: Light[], t: number) {
    main.save();
    main.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.ox * view.dpr, view.oy * view.dpr);
    main.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.bloom || l.intensity <= 0) continue;
      const at = l.bloomAt ?? [l.x, l.y, l.z];
      const [cx, cy] = p(at[0], at[1], at[2]);
      const flick = 0.94 + 0.06 * Math.sin(t * 7 + cx);
      const a = Math.min(0.85, 0.55 * l.intensity) * flick;
      const g = main.createRadialGradient(cx, cy, 0, cx, cy, l.bloom);
      g.addColorStop(0, rgba(l.color, a));
      g.addColorStop(0.3, rgba(l.color, a * 0.4));
      g.addColorStop(1, rgba(l.color, 0));
      main.fillStyle = g;
      main.fillRect(cx - l.bloom, cy - l.bloom, l.bloom * 2, l.bloom * 2);
    }
    main.restore();
  }
}

/** Cono de luz visible del flexo (volumétrico, muy suave). */
export function drawLampCone(main: CanvasRenderingContext2D, view: View, intensity: number) {
  if (intensity <= 0) return;
  main.save();
  main.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.ox * view.dpr, view.oy * view.dpr);
  main.globalCompositeOperation = 'lighter';
  const head = p(7.18, 0.62, 1.38);
  const a = p(6.35, 0.45, 0.82), b = p(7.2, 1.15, 0.82);
  const g = main.createLinearGradient(head[0], head[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  g.addColorStop(0, `rgba(255,200,120,${(0.22 * intensity).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,190,110,0)');
  main.fillStyle = g;
  main.beginPath();
  main.moveTo(head[0], head[1]);
  main.lineTo(a[0], a[1]);
  main.lineTo(b[0], b[1]);
  main.closePath();
  main.fill();
  main.restore();
}

/** Viñeta suave pre-renderizada (se regenera al redimensionar). */
export function makeVignette(view: View): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(view.w / 2);
  c.height = Math.ceil(view.h / 2);
  const ctx = c.getContext('2d')!;
  ctx.scale(0.5, 0.5);
  const r = Math.hypot(view.w, view.h) / 2;
  const g = ctx.createRadialGradient(view.w / 2, view.h * 0.48, r * 0.45, view.w / 2, view.h * 0.48, r * 1.05);
  g.addColorStop(0, 'rgba(3,4,16,0)');
  g.addColorStop(1, 'rgba(3,4,16,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
  return c;
}
