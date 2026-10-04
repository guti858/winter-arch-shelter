// Ciudad isométrica alrededor de tu edificio: manzanas con edificios de alturas variadas, calles con
// coches y peatones, farolas, semáforos y una plaza delante. No es interactiva: es el bullicio de
// fondo; tu habitación es un rincón tranquilo encima de todo eso.
//
// Todo comparte la proyección de la habitación. Los elementos estáticos se pre-renderizan como sprites
// y se ordenan una vez (orden topológico por cajas); coches y peatones (traffic.ts) se insertan cada
// frame en ese orden.
import { boxHull, drawBox, drawCylinder, fillPoly, p, pathPoly, TH, TW, TZ, type P2, type P3 } from '../engine/iso';
import { rgba, shade } from '../engine/color';
import { mulberry32 } from '../engine/random';
import { ROOM_SIZE, WALL_T } from './room';
import {
  BANDS, BLOCK, MAX, MIN, PITCH, RANGE, ROAD0, ROAD1, SIDEWALK, STOP_NEG, STOP_POS, STREET, Traffic,
  type Axis, type Mover,
} from './traffic';

export { trafficDensity } from './traffic';

/** Plaza con árboles y quiosco justo delante de tu edificio (abajo a la izquierda en pantalla). */
const PARK: [number, number] = [0, 1];
/** Farolas y semáforos van junto al bordillo; los peatones caminan por dentro. */
const CURB = SIDEWALK - 0.14;

export interface AABB { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }
export interface IsoRect { x: number; y: number; w: number; h: number }

type Dyn = (ctx: CanvasRenderingContext2D, t: number, phase: number) => void;

export interface CityItem {
  kind: 'building' | 'tower' | 'lamp' | 'tree' | 'kiosk';
  box: AABB;
  rect: IsoRect;
  paint?: (ctx: CanvasRenderingContext2D) => void;
  sprite?: HTMLCanvasElement;
  /** Detalle que cambia de vez en cuando (ventanas que parpadean): se hornea en la caché. */
  baked?: (ctx: CanvasRenderingContext2D) => void;
  /** Detalle animado cada frame (balizas, semáforos, luces del árbol). */
  dyn?: Dyn;
  /** Punto (mundo) donde se dibuja `dyn`: si otro elemento lo tapa, `dyn` no se dibuja. */
  probe?: P3;
  hidden?: boolean;
  fog: number;
  flick?: { poly: P3[]; color: string; on: boolean; next: number }[];
}

interface Lamp { x: number; y: number; ax: number; ay: number; signal?: { ix: number; iy: number; axis: Axis } }

const FACADES = ['#262b4c', '#2c2643', '#22304a', '#30294a', '#27243d', '#2f3150', '#352c45', '#1f2742'];
const WARM = ['#ffd98a', '#ffe7b0', '#ffc46b', '#ffb347', '#fff1cf'];
const COOL = ['#cfe6ff', '#a9d4ff'];
const SHOP = ['#ffbe6e', '#ff8fb1', '#7fe0d0', '#ffd98a', '#b4a0ff'];

const FOG = '#2a2350';

let probeCtx: CanvasRenderingContext2D | null = null;
/** Lienzo de 1 px para leer la opacidad de un sprite sin ralentizar los sprites (lectura frecuente). */
function probe(): CanvasRenderingContext2D {
  if (!probeCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    probeCtx = c.getContext('2d', { willReadFrequently: true })!;
  }
  return probeCtx;
}

function rectOf(hull: P2[]): IsoRect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of hull) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function boxRect(b: AABB, pad = 0): IsoRect {
  const r = rectOf(boxHull({ x: b.x0, y: b.y0, z: b.z0, w: b.x1 - b.x0, d: b.y1 - b.y0, h: b.z1 - b.z0 }));
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

const overlap = (a: IsoRect, b: IsoRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** ¿a queda detrás de b? (cajas sin solape en planta) */
function behind(a: AABB, b: AABB): boolean {
  const e = 1e-6;
  if (a.x1 <= b.x0 + e || a.y1 <= b.y0 + e) return true;
  if (b.x1 <= a.x0 + e || b.y1 <= a.y0 + e) return false;
  return a.z1 <= b.z0 + e; // apilados
}

/** Orden topológico (pintor) de elementos estáticos. */
function sortItems(items: CityItem[]): CityItem[] {
  const n = items.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!overlap(items[i].rect, items[j].rect)) continue;
      if (behind(items[i].box, items[j].box)) { after[i].push(j); indeg[j]++; }
      else if (behind(items[j].box, items[i].box)) { after[j].push(i); indeg[i]++; }
    }
  }
  const key = (it: CityItem) => it.box.x0 + it.box.x1 + it.box.y0 + it.box.y1;
  const ready = items.map((_, i) => i).filter((i) => indeg[i] === 0);
  const out: CityItem[] = [];
  while (ready.length) {
    ready.sort((a, b) => key(items[b]) - key(items[a]));
    const i = ready.pop()!;
    out.push(items[i]);
    for (const j of after[i]) if (--indeg[j] === 0) ready.push(j);
  }
  if (out.length < n) for (const it of items) if (!out.includes(it)) out.push(it); // ciclos (no debería)
  return out;
}

export class City {
  /** Elementos estáticos en orden de dibujo (incluye el marcador del edificio de la habitación). */
  items: CityItem[] = [];
  /** Coches y peatones (se conservan al reconstruir la ciudad). */
  private traffic = new Traffic();
  private ground: { canvas: HTMLCanvasElement; rect: IsoRect } | null = null;
  private z0 = -7;
  private scale = 1;
  private dpr = 1;
  private glow = 1;
  private visible: IsoRect = { x: 0, y: 0, w: 0, h: 0 };
  // Caché: todo lo estático compuesto en dos capas (detrás y delante de tu edificio)
  private cacheBack: HTMLCanvasElement | null = null;
  private cacheFront: HTMLCanvasElement | null = null;
  private towerIndex = 0;
  private dirty = true;
  private lastBake = -Infinity;

  /** (Re)construye la ciudad para la cota de calle, escala y zona visible dadas. */
  build(z0: number, scale: number, dpr: number, visible: IsoRect, glow: number) {
    this.z0 = z0;
    this.scale = scale;
    this.dpr = dpr;
    this.visible = visible;
    this.glow = glow;
    const rnd = mulberry32(7331);
    const items: CityItem[] = [];
    const lamps: Lamp[] = [];
    const shops: { x: number; y: number; c: string }[] = [];
    const D = Math.SQRT1_2;

    for (let i = -RANGE; i <= RANGE; i++) {
      for (let j = -RANGE; j <= RANGE; j++) {
        const bx = i * PITCH, by = j * PITCH;
        // Farolas junto al bordillo, con el brazo hacia la calzada: en las esquinas visibles y a mitad
        // de cada acera (en tu edificio, a los lados del portal). Las de las esquinas llevan el semáforo
        // del cruce: la delantera, el del eje y; la de la derecha, el del eje x del cruce de detrás.
        lamps.push(
          { x: bx - CURB, y: by + BLOCK + CURB, ax: -D, ay: D },
          { x: bx + BLOCK + CURB, y: by + BLOCK + CURB, ax: D, ay: D, signal: { ix: i, iy: j, axis: 'y' } },
          { x: bx + BLOCK + CURB, y: by - CURB, ax: D, ay: -D, signal: { ix: i, iy: j - 1, axis: 'x' } },
          { x: bx + BLOCK + CURB, y: by + 4, ax: 1, ay: 0 },
        );
        if (i === 0 && j === 0) lamps.push({ x: bx + 1.6, y: by + BLOCK + CURB, ax: 0, ay: 1 }, { x: bx + 6.4, y: by + BLOCK + CURB, ax: 0, ay: 1 });
        else lamps.push({ x: bx + 4, y: by + BLOCK + CURB, ax: 0, ay: 1 });
        if (i === 0 && j === 0) continue; // tu edificio
        if (i === PARK[0] && j === PARK[1]) {
          this.park(items, bx, by, rnd);
          continue;
        }
        this.block(items, i, j, bx, by, rnd, shops);
      }
    }
    for (const l of lamps) items.push(this.lamp(l));
    // marcador del edificio de la habitación (se dibuja aparte, en su sitio del orden)
    const tb: AABB = { x0: -WALL_T, y0: -WALL_T, x1: ROOM_SIZE, y1: ROOM_SIZE, z0: z0, z1: 3.2 };
    items.push({ kind: 'tower', box: tb, rect: boxRect(tb), fog: 0 });

    const vis = items.filter((it) => it.kind === 'tower' || overlap(it.rect, visible));
    this.items = sortItems(vis);
    for (const it of this.items) if (it.paint) it.sprite = this.sprite(it);
    this.towerIndex = this.items.findIndex((it) => it.kind === 'tower');
    this.items.forEach((it, i) => { it.hidden = this.occluded(i); });
    this.buildGround(lamps, shops);
    this.dirty = true;
  }

  // ------------------------------------------------------------------ generación

  /** Bruma por profundidad (+ un velo base para que la habitación sea el foco). */
  private fogFor(cx: number, cy: number): number {
    const depth = -(cx + cy); // mayor = más lejos (arriba en pantalla)
    return Math.max(0.14, Math.min(0.72, 0.14 + (depth + 6) / 60));
  }

  private block(items: CityItem[], i: number, j: number, bx: number, by: number, rnd: () => number, shops: { x: number; y: number; c: string }[]) {
    const r = rnd();
    const cells: [number, number, number, number][] =
      r < 0.22 ? [[0, 0, 8, 8]]
        : r < 0.5 ? [[0, 0, 8, 4], [0, 4, 8, 8]]
          : r < 0.78 ? [[0, 0, 4, 8], [4, 0, 8, 8]]
            : [[0, 0, 4, 4], [4, 0, 8, 4], [0, 4, 4, 8], [4, 4, 8, 8]];
    const front = i >= 0 && j >= 0;
    const side = (i > 0 && j < 0) || (i < 0 && j > 0);
    for (const [a0, b0, a1, b1] of cells) {
      const x0 = bx + a0 + 0.15, y0 = by + b0 + 0.15, x1 = bx + a1 - 0.15, y1 = by + b1 - 0.15;
      let h: number;
      if (front) h = (i <= 1 && j <= 1) ? 0.9 + rnd() * 1.0 : 1.2 + rnd() * 3.2;
      else if (side) h = 2.5 + rnd() * 8;
      else h = (i + j >= -1 ? 5 : 6) + Math.pow(rnd(), 1.4) * (i + j >= -1 ? 10 : 18);
      const box: AABB = { x0, y0, x1, y1, z0: this.z0, z1: this.z0 + h };
      const color = FACADES[Math.floor(rnd() * FACADES.length)];
      const seed = Math.floor(rnd() * 1e9);
      const shopColor = front || rnd() < 0.35 ? SHOP[Math.floor(rnd() * SHOP.length)] : null;
      const fog = this.fogFor((x0 + x1) / 2, (y0 + y1) / 2);
      const beacon = h > 13 && rnd() < 0.7;
      const flick: { poly: P3[]; color: string; on: boolean; next: number }[] = [];
      const item: CityItem = {
        kind: 'building', box, rect: boxRect(box, 18), fog,
        paint: (ctx) => this.paintBuilding(ctx, box, color, seed, shopColor, beacon, flick),
      };
      if (shopColor) {
        shops.push({ x: (x0 + x1) / 2, y: y1 + 0.5, c: shopColor });
        shops.push({ x: x1 + 0.5, y: (y0 + y1) / 2, c: shopColor });
      }
      item.baked = (ctx) => {
        for (const f of flick) if (f.on) fillPoly(ctx, f.poly, f.color);
      };
      if (beacon) item.probe = [(x0 + x1) / 2, (y0 + y1) / 2, box.z1 + 1.15];
      if (beacon) item.dyn = (ctx, t) => {
        if (Math.sin(t * 2.1 + seed) > 0.5) {
          const c = p((x0 + x1) / 2, (y0 + y1) / 2, box.z1 + 1.15);
          const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 9);
          g.addColorStop(0, 'rgba(255,70,60,0.95)');
          g.addColorStop(1, 'rgba(255,40,40,0)');
          ctx.fillStyle = g;
          ctx.fillRect(c[0] - 9, c[1] - 9, 18, 18);
        }
      };
      item.flick = flick;
      items.push(item);
    }
  }

  private paintBuilding(
    ctx: CanvasRenderingContext2D, b: AABB, color: string, seed: number, shop: string | null, beacon: boolean,
    flick: { poly: P3[]; color: string; on: boolean; next: number }[],
  ) {
    const rnd = mulberry32(seed);
    const office = rnd() < 0.22;
    const litP = 0.22 + rnd() * 0.3;
    const h = b.z1 - b.z0;
    // cuerpo
    fillPoly(ctx, [[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], color);
    fillPoly(ctx, [[b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x1, b.y0, b.z1]], shade(color, -0.3));
    // tejado nevado con pretil
    fillPoly(ctx, [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], '#4a5276');
    fillPoly(ctx, [[b.x0 + 0.12, b.y0 + 0.12, b.z1 + 0.01], [b.x1 - 0.12, b.y0 + 0.12, b.z1 + 0.01], [b.x1 - 0.12, b.y1 - 0.12, b.z1 + 0.01], [b.x0 + 0.12, b.y1 - 0.12, b.z1 + 0.01]], '#363d5c');
    // nieve acumulada en manchas
    for (let k = 0; k < 4; k++) {
      const sx = b.x0 + 0.3 + rnd() * (b.x1 - b.x0 - 1.2), sy = b.y0 + 0.3 + rnd() * (b.y1 - b.y0 - 1.2);
      fillPoly(ctx, [[sx, sy, b.z1 + 0.012], [sx + 0.9, sy + 0.1, b.z1 + 0.012], [sx + 0.8, sy + 0.7, b.z1 + 0.012], [sx + 0.1, sy + 0.6, b.z1 + 0.012]], 'rgba(120,135,180,0.35)');
    }
    // terraza con guirnalda en los edificios bajos
    if (h < 3.5 && rnd() < 0.6) {
      const tx = b.x0 + 0.5, ty = b.y0 + 0.5, tw = Math.min(3, b.x1 - b.x0 - 1), td = Math.min(2.4, b.y1 - b.y0 - 1);
      fillPoly(ctx, [[tx, ty, b.z1 + 0.015], [tx + tw, ty, b.z1 + 0.015], [tx + tw, ty + td, b.z1 + 0.015], [tx, ty + td, b.z1 + 0.015]], '#4a3b3a');
      for (let m = 0; m <= 8; m++) {
        const u = m / 8;
        const q = p(tx + tw * u, ty + td, b.z1 + 0.5 - Math.sin(u * Math.PI) * 0.12);
        ctx.fillStyle = m % 2 ? 'rgba(255,217,138,0.95)' : 'rgba(255,179,71,0.9)';
        ctx.beginPath();
        ctx.arc(q[0], q[1], 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      drawBox(ctx, tx + 0.3, ty + 0.3, b.z1, 0.5, 0.5, 0.25, '#5a4a40');
    }
    // ventanas
    const winColor = () => (rnd() < 0.85 ? WARM[Math.floor(rnd() * WARM.length)] : COOL[Math.floor(rnd() * COOL.length)]);
    const glowK = Math.min(1, this.glow);
    const rowStart = b.z0 + (shop ? 0.95 : 0.5);
    for (const face of ['l', 'r'] as const) {
      const u0 = face === 'l' ? b.x0 : b.y0, u1 = face === 'l' ? b.x1 : b.y1;
      const span = u1 - u0;
      const cols = Math.max(1, Math.floor((span - 0.3) / 0.62));
      const pad = (span - cols * 0.62) / 2;
      for (let z = rowStart; z + 0.3 < b.z1 - 0.2; z += 0.5) {
        const rowLit = office ? rnd() < litP * 1.3 : true;
        for (let c = 0; c < cols; c++) {
          const a = u0 + pad + c * 0.62 + 0.15, e = a + 0.32;
          const poly: P3[] = face === 'l'
            ? [[a, b.y1 + 0.005, z], [e, b.y1 + 0.005, z], [e, b.y1 + 0.005, z + 0.22], [a, b.y1 + 0.005, z + 0.22]]
            : [[b.x1 + 0.005, a, z], [b.x1 + 0.005, e, z], [b.x1 + 0.005, e, z + 0.22], [b.x1 + 0.005, a, z + 0.22]];
          const on = office ? rowLit && rnd() < 0.9 : rnd() < litP;
          const col = winColor();
          const alpha = (0.55 + rnd() * 0.45) * (0.7 + 0.3 * glowK);
          const lit = rgba(face === 'r' ? shade(col, -0.12) : col, alpha);
          if (rnd() < 0.03) {
            flick.push({ poly, color: lit, on, next: 2 + rnd() * 30 });
            fillPoly(ctx, poly, rgba('#10122a', 0.9));
            continue;
          }
          fillPoly(ctx, poly, on ? lit : rgba(face === 'l' ? '#151830' : '#101226', 0.95));
        }
      }
    }
    // planta baja comercial
    if (shop) {
      const z = b.z0 + 0.1, zt = b.z0 + 0.62;
      fillPoly(ctx, [[b.x0 + 0.3, b.y1 + 0.01, z], [b.x1 - 0.3, b.y1 + 0.01, z], [b.x1 - 0.3, b.y1 + 0.01, zt], [b.x0 + 0.3, b.y1 + 0.01, zt]], rgba(shop, 0.85));
      fillPoly(ctx, [[b.x1 + 0.01, b.y0 + 0.3, z], [b.x1 + 0.01, b.y1 - 0.3, z], [b.x1 + 0.01, b.y1 - 0.3, zt], [b.x1 + 0.01, b.y0 + 0.3, zt]], rgba(shade(shop, -0.15), 0.8));
      drawBox(ctx, b.x0 + 0.2, b.y1, zt, b.x1 - b.x0 - 0.4, 0.28, 0.06, shade(shop, -0.55));
      drawBox(ctx, b.x1, b.y0 + 0.2, zt, 0.28, b.y1 - b.y0 - 0.4, 0.06, shade(shop, -0.6));
    }
    // azotea: máquinas, depósitos y antenas
    const items = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < items; k++) {
      const x = b.x0 + 0.4 + rnd() * (b.x1 - b.x0 - 1.2), y = b.y0 + 0.4 + rnd() * (b.y1 - b.y0 - 1.2);
      if (rnd() < 0.5) drawBox(ctx, x, y, b.z1, 0.6, 0.45, 0.3, '#3a4062');
      else drawCylinder(ctx, x + 0.3, y + 0.3, b.z1, 0.28, 0.5, '#454a6a');
    }
    if (beacon || h > 11) {
      const c = p((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1), top = p((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 1.1);
      ctx.strokeStyle = '#3a3f5c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
    }
  }

  private park(items: CityItem[], bx: number, by: number, rnd: () => number) {
    // árboles nevados alrededor de un quiosco iluminado
    const spots: [number, number, number][] = [[1.2, 1.4, 1], [6.6, 1.2, 0.9], [1.3, 6.5, 1.1], [6.7, 6.6, 1], [4, 1, 0.8], [1, 4, 0.85], [6.9, 4.1, 0.9], [4.1, 7, 0.95]];
    for (const [x, y, s] of spots) items.push(this.tree(bx + x, by + y, s * (0.85 + rnd() * 0.3), false));
    items.push(this.tree(bx + 2.6, by + 2.6, 1.5, true)); // el árbol grande (se ilumina en la fase 3)
    items.push(this.kiosk(bx + 4.6, by + 4.6));
  }

  private tree(x: number, y: number, s: number, big: boolean): CityItem {
    const r = 0.45 * s;
    const box: AABB = { x0: x - r, y0: y - r, x1: x + r, y1: y + r, z0: this.z0, z1: this.z0 + 1.8 * s };
    const z0 = this.z0;
    const lights: P2[] = [];
    const paint = (ctx: CanvasRenderingContext2D) => {
      drawBox(ctx, x - 0.05, y - 0.05, z0, 0.1, 0.1, 0.45 * s, '#3b2c28');
      for (let k = 0; k < 3; k++) {
        const c = p(x, y, z0 + 0.45 * s + k * 0.4 * s);
        const rx = (r * 32 * Math.SQRT2) * (1 - k * 0.28);
        ctx.fillStyle = k % 2 ? '#2a4a46' : '#22403e';
        ctx.beginPath();
        ctx.moveTo(c[0] - rx, c[1]);
        ctx.lineTo(c[0], c[1] - 22 * s);
        ctx.lineTo(c[0] + rx, c[1]);
        ctx.quadraticCurveTo(c[0], c[1] + rx * 0.4, c[0] - rx, c[1]);
        ctx.fill();
        // nieve
        ctx.fillStyle = 'rgba(205,220,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(c[0] - rx * 0.5, c[1] - 11 * s);
        ctx.lineTo(c[0], c[1] - 22 * s);
        ctx.lineTo(c[0] + rx * 0.5, c[1] - 11 * s);
        ctx.closePath();
        ctx.fill();
        if (big) for (let m = 0; m < 6; m++) lights.push([c[0] + (m / 5 - 0.5) * rx * 1.4, c[1] - 3 - (m % 2) * 4]);
      }
    };
    const item: CityItem = { kind: 'tree', box, rect: boxRect(box, 26 * s), fog: this.fogFor(x, y), paint };
    if (big) {
      item.dyn = (ctx, t, phase) => {
        if (phase < 3) return; // en diciembre (fase Remate) el árbol del parque se enciende
        lights.forEach((l, m) => {
          const a = 0.55 + 0.45 * Math.sin(t * 3 + m * 1.7);
          ctx.fillStyle = rgba(m % 3 === 0 ? '#ff8f8f' : m % 3 === 1 ? '#ffd98a' : '#9fe0ff', a);
          ctx.beginPath();
          ctx.arc(l[0], l[1], 1.6, 0, Math.PI * 2);
          ctx.fill();
        });
      };
    }
    return item;
  }

  private kiosk(x: number, y: number): CityItem {
    const box: AABB = { x0: x - 0.6, y0: y - 0.6, x1: x + 0.6, y1: y + 0.6, z0: this.z0, z1: this.z0 + 1.2 };
    const z0 = this.z0;
    return {
      kind: 'kiosk', box, rect: boxRect(box, 30), fog: 0,
      paint: (ctx) => {
        const c = p(x, y + 0.6, z0 + 0.35);
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 40);
        g.addColorStop(0, 'rgba(255,190,110,0.4)');
        g.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.fillStyle = g;
        ctx.fillRect(c[0] - 40, c[1] - 40, 80, 80);
        drawBox(ctx, x - 0.5, y - 0.5, z0, 1, 1, 0.8, '#5a3b3b');
        fillPoly(ctx, [[x - 0.4, y + 0.505, z0 + 0.25], [x + 0.4, y + 0.505, z0 + 0.25], [x + 0.4, y + 0.505, z0 + 0.6], [x - 0.4, y + 0.505, z0 + 0.6]], '#ffc77a');
        fillPoly(ctx, [[x + 0.505, y - 0.4, z0 + 0.25], [x + 0.505, y + 0.4, z0 + 0.25], [x + 0.505, y + 0.4, z0 + 0.6], [x + 0.505, y - 0.4, z0 + 0.6]], '#e8a85e');
        drawBox(ctx, x - 0.62, y - 0.62, z0 + 0.8, 1.24, 1.24, 0.08, '#d9e2ff');
        drawBox(ctx, x - 0.3, y - 0.3, z0 + 0.88, 0.6, 0.6, 0.25, '#7a3f3f');
      },
    };
  }

  private lamp(l: Lamp): CityItem {
    const { x, y, ax, ay, signal } = l;
    const box: AABB = { x0: x - 0.08, y0: y - 0.08, x1: x + 0.08, y1: y + 0.08, z0: this.z0, z1: this.z0 + 1.5 };
    const z0 = this.z0;
    const hx = x + ax * 0.32, hy = y + ay * 0.32; // luminaria, sobre el borde de la calzada
    const post = '#3a3d55';
    const item: CityItem = {
      kind: 'lamp', box, rect: boxRect(box, 34), fog: this.fogFor(x, y),
      paint: (ctx) => {
        drawBox(ctx, x - 0.06, y - 0.06, z0, 0.12, 0.12, 0.08, '#2c2f44');
        drawBox(ctx, x - 0.035, y - 0.035, z0, 0.07, 0.07, 1.42, post);
        if (signal) this.signalHead(ctx, x, y, signal.axis);
        const a = p(x, y, z0 + 1.4), b = p(hx, hy, z0 + 1.45);
        ctx.strokeStyle = post;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        drawBox(ctx, hx - 0.09, hy - 0.09, z0 + 1.41, 0.18, 0.18, 0.05, '#2a2d42');
        const head = p(hx, hy, z0 + 1.39);
        const g = ctx.createRadialGradient(head[0], head[1] + 1, 0, head[0], head[1] + 1, 20);
        g.addColorStop(0, 'rgba(255,214,150,0.8)');
        g.addColorStop(0.25, 'rgba(255,190,110,0.32)');
        g.addColorStop(1, 'rgba(255,170,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(head[0] - 20, head[1] - 19, 40, 40);
        ctx.fillStyle = '#fff1cf';
        ctx.beginPath();
        ctx.ellipse(head[0], head[1], 2.8, 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      },
    };
    if (signal) {
      const lit = ['#ff4a3d', '#ffb02e', '#4dffa0'];
      const order = { r: 0, a: 1, g: 2 } as const;
      item.probe = [x, y, z0 + 1.0];
      item.dyn = (ctx) => {
        const k = order[this.traffic.signal(signal.ix, signal.iy, signal.axis)];
        const c = this.lensAt(x, y, signal.axis, k);
        ctx.fillStyle = rgba(lit[k], 0.3);
        ctx.beginPath();
        ctx.arc(c[0], c[1], 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lit[k];
        ctx.beginPath();
        ctx.arc(c[0], c[1], 1.5, 0, Math.PI * 2);
        ctx.fill();
      };
    }
    return item;
  }

  /** Lente k (0 rojo, 1 ámbar, 2 verde) del semáforo: en la cara que mira a la calzada de su eje. */
  private lensAt(x: number, y: number, axis: Axis, k: number): P2 {
    const z = this.z0 + 1.08 - k * 0.09;
    return axis === 'x' ? p(x + 0.062, y, z) : p(x, y + 0.062, z);
  }

  /** Caja del semáforo en el poste de la farola, con las tres lentes apagadas. */
  private signalHead(ctx: CanvasRenderingContext2D, x: number, y: number, axis: Axis) {
    drawBox(ctx, x - 0.06, y - 0.06, this.z0 + 0.86, 0.12, 0.12, 0.3, '#15172a');
    ['#3a1418', '#3a2c12', '#123a26'].forEach((c, k) => {
      const q = this.lensAt(x, y, axis, k);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 1.3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /** ¿Algún elemento que se pinta después tapa el punto donde va `dyn` (luz de semáforo, baliza)? */
  private occluded(i: number): boolean {
    const it = this.items[i];
    if (!it.probe || !it.dyn) return false;
    const q = p(it.probe[0], it.probe[1], it.probe[2]);
    const end = i < this.towerIndex ? this.towerIndex : this.items.length;
    const k = this.scale * this.dpr;
    const px = probe();
    for (let j = i + 1; j < end; j++) {
      const o = this.items[j], r = o.rect;
      if (!o.sprite || q[0] < r.x || q[1] < r.y || q[0] >= r.x + r.w || q[1] >= r.y + r.h) continue;
      px.clearRect(0, 0, 1, 1);
      px.drawImage(o.sprite, Math.floor((q[0] - r.x) * k), Math.floor((q[1] - r.y) * k), 1, 1, 0, 0, 1, 1);
      if (px.getImageData(0, 0, 1, 1).data[3] > 170) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ sprites y suelo

  private sprite(it: CityItem): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const k = this.scale * this.dpr;
    c.width = Math.max(1, Math.ceil(it.rect.w * k));
    c.height = Math.max(1, Math.ceil(it.rect.h * k));
    const ctx = c.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, -it.rect.x * k, -it.rect.y * k);
    it.paint!(ctx);
    if (it.fog > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = rgba(FOG, it.fog);
      ctx.fillRect(it.rect.x, it.rect.y, it.rect.w, it.rect.h);
    }
    return c;
  }

  private buildGround(lamps: Lamp[], shops: { x: number; y: number; c: string }[]) {
    const v = this.visible;
    const k = this.scale; // el suelo es suave: basta 1x
    const c = document.createElement('canvas');
    c.width = Math.ceil(v.w * k);
    c.height = Math.ceil(v.h * k);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
    const z = this.z0;
    const quad = (x0: number, y0: number, x1: number, y1: number, col: string) =>
      fillPoly(ctx, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], col);
    // asfalto
    quad(MIN, MIN, MAX, MAX, '#14162b');
    // línea discontinua central, solo en los tramos entre cruces
    const dash = 'rgba(61,66,102,0.6)';
    for (let g = BANDS.from; g <= BANDS.to; g++) {
      const mid = g * PITCH + BLOCK + STREET / 2;
      for (let i = -RANGE; i <= RANGE; i++) {
        const a = i * PITCH + 0.6, e = i * PITCH + BLOCK - 0.6;
        for (let u = a; u < e; u += 1.3) {
          const u1 = Math.min(u + 0.6, e);
          quad(u, mid - 0.04, u1, mid + 0.04, dash);
          quad(mid - 0.04, u, mid + 0.04, u1, dash);
        }
      }
    }
    // aceras y manzanas
    for (let i = -RANGE; i <= RANGE; i++) {
      for (let j = -RANGE; j <= RANGE; j++) {
        const bx = i * PITCH, by = j * PITCH;
        quad(bx - SIDEWALK, by - SIDEWALK, bx + BLOCK + SIDEWALK, by + BLOCK + SIDEWALK, '#282c48');
        // bordillo nevado
        ctx.strokeStyle = 'rgba(160,180,230,0.35)';
        ctx.lineWidth = 1;
        const a = p(bx - SIDEWALK, by + BLOCK + SIDEWALK, z), b = p(bx + BLOCK + SIDEWALK, by + BLOCK + SIDEWALK, z), d = p(bx + BLOCK + SIDEWALK, by - SIDEWALK, z);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]);
        ctx.stroke();
        if (i === PARK[0] && j === PARK[1]) {
          // parque nevado con caminos
          quad(bx, by, bx + BLOCK, by + BLOCK, '#2b3456');
          quad(bx + 3.7, by, bx + 4.3, by + BLOCK, '#3a4468');
          quad(bx, by + 3.7, bx + BLOCK, by + 4.3, '#3a4468');
        } else {
          quad(bx, by, bx + BLOCK, by + BLOCK, '#1b1e35');
        }
      }
    }
    // Cada cruce: pasos de cebra en línea con las aceras (franjas paralelas al tráfico que cruzan) y
    // líneas de detención antes de ellos, solo en el carril que llega al cruce.
    const zebra = 'rgba(190,200,235,0.3)', stop = 'rgba(200,210,240,0.4)';
    for (let ix = BANDS.from; ix <= BANDS.to; ix++) {
      for (let iy = BANDS.from; iy <= BANDS.to; iy++) {
        const x0 = ix * PITCH, y0 = iy * PITCH;
        for (let s = 0; s < 8; s++) {
          const a = ROAD0 + 0.07 + s * 0.29;
          for (const [w0, w1] of [[BLOCK + 0.06, ROAD0 - 0.06], [ROAD1 + 0.06, PITCH - 0.06]]) {
            quad(x0 + a, y0 + w0, x0 + a + 0.15, y0 + w1, zebra); // cruzan la calle del eje y
            quad(x0 + w0, y0 + a, x0 + w1, y0 + a + 0.15, zebra); // cruzan la calle del eje x
          }
        }
        const midW = BLOCK + STREET / 2;
        quad(x0 + STOP_POS - 0.1, y0 + midW + 0.04, x0 + STOP_POS, y0 + ROAD1, stop); // hacia +x
        quad(x0 + STOP_NEG, y0 + ROAD0, x0 + STOP_NEG + 0.1, y0 + midW - 0.04, stop); // hacia −x
        quad(x0 + ROAD0, y0 + STOP_POS - 0.1, x0 + midW - 0.04, y0 + STOP_POS, stop); // hacia +y
        quad(x0 + midW + 0.04, y0 + STOP_NEG, x0 + ROAD1, y0 + STOP_NEG + 0.1, stop); // hacia −y
      }
    }
    // charcos de luz de farolas y escaparates
    ctx.globalCompositeOperation = 'lighter';
    const pool = (x: number, y: number, r: number, col: string, a: number) => {
      const c0 = p(x, y, z);
      ctx.save();
      ctx.translate(c0[0], c0[1]);
      ctx.scale(1, 0.5);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    for (const l of lamps) {
      const x = l.x + l.ax * 0.32, y = l.y + l.ay * 0.32;
      pool(x, y, 58, '#ffb066', 0.28 * (1 - this.fogFor(x, y)));
    }
    for (const s of shops) pool(s.x, s.y, 46, s.c, 0.16 * (1 - this.fogFor(s.x, s.y)));
    pool(4, BLOCK + 0.9, 70, '#ffc27a', 0.3); // portal de tu edificio
    ctx.globalCompositeOperation = 'source-over';
    // bruma: el fondo se funde con el horizonte
    ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
    const g = ctx.createLinearGradient(0, p(-30, -30, z)[1], 0, p(0, 0, z)[1]);
    g.addColorStop(0, rgba(FOG, 0.85));
    g.addColorStop(1, rgba(FOG, 0));
    ctx.fillStyle = g;
    ctx.fillRect(v.x, v.y, v.w, v.h);
    this.ground = { canvas: c, rect: v };
  }

  // ------------------------------------------------------------------ coches y peatones

  update(dt: number, hour: number) {
    this.traffic.update(dt, hour);
    for (const it of this.items) {
      if (!it.flick) continue;
      for (const w of it.flick) {
        w.next -= dt;
        if (w.next <= 0) { w.on = !w.on; w.next = 10 + Math.random() * 30; this.dirty = true; }
      }
    }
  }

  private moverBox(m: Mover): AABB {
    const cx = m.axis === 'x' ? m.pos : m.lane, cy = m.axis === 'x' ? m.lane : m.pos;
    const hx = (m.axis === 'x' ? m.len : m.wid) / 2, hy = (m.axis === 'x' ? m.wid : m.len) / 2;
    return { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, z0: this.z0, z1: this.z0 + m.h + (m.umbrella ? 0.16 : 0) };
  }

  private drawMover(ctx: CanvasRenderingContext2D, m: Mover, b: AABB) {
    if (m.kind === 'car') this.drawCar(ctx, m, b);
    else this.drawWalker(ctx, m, b);
  }

  /** Rueda: disco en el plano del costado (x–z si el coche va por x, y–z si va por y). */
  private wheel(ctx: CanvasRenderingContext2D, at: P3, alongX: boolean) {
    const c = p(at[0], at[1], at[2]);
    ctx.save();
    ctx.transform(alongX ? TW / 2 : -TW / 2, TH / 2, 0, -TZ, c[0], c[1]);
    ctx.fillStyle = '#0b0c14';
    ctx.beginPath();
    ctx.arc(0, 0, 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4e66';
    ctx.beginPath();
    ctx.arc(0, 0, 0.036, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCar(ctx: CanvasRenderingContext2D, m: Mover, b: AABB) {
    const z = this.z0;
    const ax = m.axis === 'x';
    // ejes del coche: u a lo largo de la marcha, w a lo ancho. Las caras visibles son las de u1 y w1.
    const u0 = ax ? b.x0 : b.y0, u1 = ax ? b.x1 : b.y1, w0 = ax ? b.y0 : b.x0, w1 = ax ? b.y1 : b.x1;
    const P = (u: number, w: number, h: number): P3 => (ax ? [u, w, h] : [w, u, h]);
    const quad = (ua: number, ub: number, wa: number, wb: number, h: number): P3[] => [P(ua, wa, h), P(ub, wa, h), P(ub, wb, h), P(ua, wb, h)];
    const box = (ua: number, wa: number, h0: number, du: number, dw: number, dh: number, c: string) =>
      (ax ? drawBox(ctx, ua, wa, h0, du, dw, dh, c) : drawBox(ctx, wa, ua, h0, dw, du, dh, c));
    const endFace = (u: number, wa: number, wb: number, ha: number, hb: number, c: string) =>
      fillPoly(ctx, [P(u, wa, ha), P(u, wb, ha), P(u, wb, hb), P(u, wa, hb)], c);
    const sideFace = (w: number, ua: number, ub: number, ha: number, hb: number, c: string) =>
      fillPoly(ctx, [P(ua, w, ha), P(ub, w, ha), P(ub, w, hb), P(ua, w, hb)], c);
    const front = m.dir > 0 ? u1 : u0, back = m.dir > 0 ? u0 : u1;
    const cu = (u0 + u1) / 2, cw = (w0 + w1) / 2;

    // sombra de contacto
    fillPoly(ctx, quad(u0 - 0.05, u1 + 0.05, w0 - 0.03, w1 + 0.07, z), 'rgba(4,5,14,0.5)');
    // en el asfalto: haz de los faros por delante y resplandor rojo de los pilotos por detrás
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tip = front + m.dir * 2.4;
    const f0 = p(...P(front, cw, z)), f1 = p(...P(tip, cw, z));
    let g = ctx.createLinearGradient(f0[0], f0[1], f1[0], f1[1]);
    g.addColorStop(0, 'rgba(255,240,200,0.3)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    pathPoly(ctx, [P(front, w0 + 0.05, z), P(tip, w0 - 0.35, z), P(tip, w1 + 0.35, z), P(front, w1 - 0.05, z)]);
    ctx.fillStyle = g;
    ctx.fill();
    const tail = back - m.dir * (m.brake ? 0.75 : 0.4);
    const t0 = p(...P(back, cw, z)), t1 = p(...P(tail, cw, z));
    g = ctx.createLinearGradient(t0[0], t0[1], t1[0], t1[1]);
    g.addColorStop(0, m.brake ? 'rgba(255,50,40,0.34)' : 'rgba(255,50,40,0.12)');
    g.addColorStop(1, 'rgba(255,50,40,0)');
    pathPoly(ctx, quad(Math.min(back, tail), Math.max(back, tail), w0 - 0.04, w1 + 0.04, z));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // ruedas del costado oculto (asoman bajo la carrocería)
    const axle = (u1 - u0) / 2 - 0.2;
    for (const du of [-axle, axle]) this.wheel(ctx, P(cu + du, w0 + 0.03, z + 0.09), ax);
    // carrocería y habitáculo (retrasado respecto a la marcha; en la furgoneta, casi todo el largo)
    const zb = z + 0.1, hb = m.van ? 0.3 : 0.2;
    box(u0, w0, zb, u1 - u0, w1 - w0, hb, m.color);
    const cl = m.van ? u1 - u0 - 0.32 : 0.5;
    const ca = m.van ? (m.dir > 0 ? u0 + 0.04 : u1 - 0.04 - cl) : cu - cl / 2 - m.dir * 0.06;
    const cw0 = w0 + 0.04, cw1 = w1 - 0.04, ch0 = zb + hb, ch = m.van ? 0.2 : 0.16;
    const cabin = shade(m.color, 0.12);
    box(ca, cw0, ch0, cl, cw1 - cw0, ch, cabin);
    // cristales: ventanillas en el costado visible y parabrisas (o luna trasera) en el extremo visible
    const glass = '#1b2238';
    const g0 = ch0 + 0.03, g1 = ch0 + ch - 0.025;
    sideFace(cw1 + 0.002, ca + 0.05, ca + cl - 0.05, g0, g1, glass);
    if (!m.van) sideFace(cw1 + 0.003, ca + cl / 2 - 0.016, ca + cl / 2 + 0.016, g0, g1, shade(cabin, ax ? -0.25 : -0.45));
    endFace(ca + cl + 0.002, cw0 + 0.03, cw1 - 0.03, g0, g1, m.dir > 0 ? '#28345a' : glass);
    endFace(ca + cl + 0.003, cw0 + 0.06, cw0 + 0.11, g0 + 0.01, g1 - 0.01, 'rgba(170,200,255,0.25)');
    if (m.snow) fillPoly(ctx, quad(ca + 0.04, ca + cl - 0.04, cw0 + 0.03, cw1 - 0.03, ch0 + ch + 0.001), 'rgba(225,235,255,0.72)');
    // faros si viene hacia ti; pilotos (más vivos al frenar) si se aleja
    const lz0 = zb + hb - 0.09, lz1 = zb + hb - 0.03;
    const lamp = m.dir > 0 ? '#fff4d6' : m.brake ? '#ff3b30' : '#a3262c';
    for (const [wa, wb] of [[w0 + 0.04, w0 + 0.12], [w1 - 0.12, w1 - 0.04]]) endFace(u1 + 0.002, wa, wb, lz0, lz1, lamp);
    if (m.dir > 0 || m.brake) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = m.dir > 0 ? 'rgba(255,240,200,0.35)' : 'rgba(255,60,50,0.4)';
      for (const w of [w0 + 0.08, w1 - 0.08]) {
        const q = p(...P(u1 + 0.01, w, (lz0 + lz1) / 2));
        ctx.beginPath();
        ctx.arc(q[0], q[1], 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // ruedas del costado visible
    for (const du of [-axle, axle]) this.wheel(ctx, P(cu + du, w1 + 0.005, z + 0.09), ax);
  }

  private drawWalker(ctx: CanvasRenderingContext2D, m: Mover, b: AABB) {
    const z = this.z0;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const ax = m.axis === 'x';
    const s = p(cx, cy, z);
    ctx.fillStyle = 'rgba(4,5,14,0.45)';
    ctx.beginPath();
    ctx.ellipse(s[0], s[1], 3.4, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // piernas: zancada al andar, juntas al esperar
    const swing = m.v > 0.01 ? Math.sin(m.stride * 26) * 0.06 : 0;
    ctx.strokeStyle = '#151624';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [side, k] of [[-0.03, 1], [0.03, -1]]) {
      const hip = ax ? p(cx, cy + side, z + 0.17) : p(cx + side, cy, z + 0.17);
      const foot = ax ? p(cx + swing * k, cy + side, z + 0.01) : p(cx + side, cy + swing * k, z + 0.01);
      ctx.moveTo(hip[0], hip[1]);
      ctx.lineTo(foot[0], foot[1]);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    // abrigo, cabeza y gorro
    drawBox(ctx, cx - 0.06, cy - 0.06, z + 0.15, 0.12, 0.12, 0.22, m.color);
    const head = p(cx, cy, z + 0.43);
    ctx.fillStyle = '#c9a98a';
    ctx.beginPath();
    ctx.arc(head[0], head[1], 1.8, 0, Math.PI * 2);
    ctx.fill();
    if (m.hat) {
      ctx.fillStyle = m.hat;
      ctx.beginPath();
      ctx.arc(head[0], head[1] - 0.5, 1.9, Math.PI, 0);
      ctx.fill();
    }
    if (m.umbrella) {
      const hand = p(cx, cy, z + 0.33), top = p(cx, cy, z + 0.64);
      ctx.strokeStyle = '#2a2b3a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(hand[0] + 1.5, hand[1]);
      ctx.lineTo(top[0] + 1.5, top[1]);
      ctx.stroke();
      ctx.fillStyle = shade(m.umbrella, -0.3);
      ctx.beginPath();
      ctx.ellipse(top[0] + 1.5, top[1] + 1, 7.5, 3.6, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(225,235,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(top[0] + 1.5, top[1] - 1.2, 4.5, 1.5, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ dibujo

  /** Compone suelo + sprites (+ ventanas que parpadean) en las dos capas de caché. */
  private bake() {
    const v = this.visible;
    const k = this.scale * this.dpr;
    const make = (prev: HTMLCanvasElement | null) => {
      const c = prev ?? document.createElement('canvas');
      const w = Math.ceil(v.w * k), h = Math.ceil(v.h * k);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      return { c, ctx };
    };
    const back = make(this.cacheBack);
    const front = make(this.cacheFront);
    if (this.ground) back.ctx.drawImage(this.ground.canvas, 0, 0, back.c.width, back.c.height);
    this.items.forEach((it, i) => {
      if (it.kind === 'tower') return;
      this.paintItem(i < this.towerIndex ? back.ctx : front.ctx, it, k, v.x, v.y);
    });
    this.cacheBack = back.c;
    this.cacheFront = front.c;
    this.dirty = false;
  }

  /** Pinta un elemento estático (sprite + detalle horneado) con la transformación dada. */
  private paintItem(ctx: CanvasRenderingContext2D, it: CityItem, k: number, ox: number, oy: number) {
    if (it.sprite) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(it.sprite, (it.rect.x - ox) * k, (it.rect.y - oy) * k, it.rect.w * k, it.rect.h * k);
    }
    if (it.baked) {
      ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
      ctx.globalAlpha = 1 - it.fog;
      it.baked(ctx);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Dibuja la ciudad: capa de caché trasera, coches/peatones de detrás, tu edificio (`onTower`),
   * capa delantera y coches/peatones de delante. Cada móvil se dibuja encima de la caché y después se
   * repintan, recortados a su caja, los elementos que deben taparlo: el orden queda exacto sin
   * redibujar toda la ciudad cada frame.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    view: { ox: number; oy: number; scale: number; dpr: number },
    t: number, phase: number,
    onTower: () => void,
  ) {
    const { ox, oy, scale, dpr } = view;
    if (!this.cacheBack || (this.dirty && t - this.lastBake > 0.5)) {
      this.bake();
      this.lastBake = t;
    }
    const v = this.visible;
    const items = this.items;
    const ti = this.towerIndex;
    const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const world = () => ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
    const cx = ox + v.x * scale, cy = oy + v.y * scale, cw = v.w * scale, ch = v.h * scale;

    // posición de cada móvil visible en el orden estático
    const placed: { m: Mover; b: AABB; r: IsoRect; at: number }[] = [];
    for (const m of this.traffic.movers) {
      if (!m.visible) continue;
      const b = this.moverBox(m);
      // la caja de repintado incluye el haz de los faros (2,4 u por delante) y el brillo de los pilotos
      const ahead = m.kind === 'car' ? 2.6 : 0, rear = m.kind === 'car' ? 0.8 : 0;
      const d0 = m.dir > 0 ? -rear : -ahead, d1 = m.dir > 0 ? ahead : rear;
      const ext: AABB = m.axis === 'x'
        ? { ...b, x0: b.x0 + d0, x1: b.x1 + d1, y0: b.y0 - 0.4, y1: b.y1 + 0.4 }
        : { ...b, y0: b.y0 + d0, y1: b.y1 + d1, x0: b.x0 - 0.4, x1: b.x1 + 0.4 };
      const r = boxRect(ext, 12);
      if (!overlap(r, v)) continue;
      let lo = -1, hi = items.length;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!overlap(r, it.rect)) continue;
        if (behind(it.box, b)) lo = i;
        else if (behind(b, it.box) && i < hi) hi = i;
      }
      placed.push({ m, b, r, at: Math.min(lo + 1, hi) });
    }
    placed.sort((a, c) => a.at - c.at || (a.b.x0 + a.b.y0) - (c.b.x0 + c.b.y0));

    const drawMovers = (from: number, to: number) => {
      for (const { m, b, r, at } of placed) {
        if (at < from || at > to) continue;
        world();
        this.drawMover(ctx, m, b);
        // repinta, recortado a la caja del móvil, lo que va delante de él dentro de esta capa
        screen();
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox + r.x * scale, oy + r.y * scale, r.w * scale, r.h * scale);
        ctx.clip();
        for (let i = at; i < to; i++) {
          const it = items[i];
          if (it.kind === 'tower' || !overlap(r, it.rect)) continue;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (it.sprite) ctx.drawImage(it.sprite, ox + it.rect.x * scale, oy + it.rect.y * scale, it.rect.w * scale, it.rect.h * scale);
          if (it.baked) {
            world();
            ctx.globalAlpha = 1 - it.fog;
            it.baked(ctx);
            ctx.globalAlpha = 1;
          }
        }
        ctx.restore();
      }
    };
    const live = (from: number, to: number) => {
      world();
      for (let i = from; i < to; i++) {
        const it = items[i];
        if (!it.dyn || it.hidden) continue;
        ctx.globalAlpha = 1 - it.fog;
        it.dyn(ctx, t, phase);
      }
      ctx.globalAlpha = 1;
    };

    screen();
    ctx.drawImage(this.cacheBack!, cx, cy, cw, ch);
    drawMovers(0, ti);
    live(0, ti);
    onTower();
    screen();
    ctx.drawImage(this.cacheFront!, cx, cy, cw, ch);
    drawMovers(ti + 1, items.length);
    live(ti + 1, items.length);
    screen();
  }
}
