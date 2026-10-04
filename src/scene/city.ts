// Ciudad isométrica alrededor de tu edificio: manzanas con edificios de alturas variadas, calles con
// coches y peatones, farolas, semáforos y una plaza delante. No es interactiva: es el bullicio de
// fondo; tu habitación es un rincón tranquilo encima de todo eso.
//
// Todo comparte la proyección de la habitación. Los elementos estáticos se pre-renderizan como sprites
// y se ordenan una vez (orden topológico por cajas); coches y peatones se insertan cada frame en ese orden.
import { boxHull, drawBox, drawCylinder, fillPoly, p, pathPoly, type P2, type P3 } from '../engine/iso';
import { rgba, shade } from '../engine/color';
import { mulberry32 } from '../engine/random';
import { ROOM_SIZE, WALL_T } from './room';

export const BLOCK = 8;
export const STREET = 4;
export const PITCH = BLOCK + STREET;
const SIDEWALK = 0.8;
const RANGE = 3; // manzanas de −3 a 3 en cada eje
/** Plaza con árboles y quiosco justo delante de tu edificio (abajo a la izquierda en pantalla). */
const PARK: [number, number] = [0, 1];
const MIN = -RANGE * PITCH - STREET;
const MAX = RANGE * PITCH + BLOCK + STREET;

export interface AABB { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }
export interface IsoRect { x: number; y: number; w: number; h: number }

type Dyn = (ctx: CanvasRenderingContext2D, t: number, phase: number) => void;

export interface CityItem {
  kind: 'building' | 'tower' | 'lamp' | 'tree' | 'signal' | 'kiosk';
  box: AABB;
  rect: IsoRect;
  paint?: (ctx: CanvasRenderingContext2D) => void;
  sprite?: HTMLCanvasElement;
  /** Detalle que cambia de vez en cuando (ventanas que parpadean): se hornea en la caché. */
  baked?: (ctx: CanvasRenderingContext2D) => void;
  /** Detalle animado cada frame (balizas, semáforos, luces del árbol). */
  dyn?: Dyn;
  fog: number;
  flick?: { poly: P3[]; color: string; on: boolean; next: number }[];
}

interface Mover {
  axis: 'x' | 'y';
  lane: number; // coordenada fija (y si axis = x)
  pos: number;
  dir: 1 | -1;
  speed: number;
  len: number;
  wid: number;
  color: string;
  rank: number; // 0..1: aparece si rank < densidad
  visible: boolean;
  kind: 'car' | 'walker';
  umbrella?: string;
}

const FACADES = ['#262b4c', '#2c2643', '#22304a', '#30294a', '#27243d', '#2f3150', '#352c45', '#1f2742'];
const WARM = ['#ffd98a', '#ffe7b0', '#ffc46b', '#ffb347', '#fff1cf'];
const COOL = ['#cfe6ff', '#a9d4ff'];
const SHOP = ['#ffbe6e', '#ff8fb1', '#7fe0d0', '#ffd98a', '#b4a0ff'];
const CARS = ['#a33d3d', '#3d5ea8', '#c8cbd8', '#2d2f3d', '#d6ad48', '#4f7d5c', '#7a4f9a'];

const FOG = '#2a2350';

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

/** Densidad de tráfico según la hora real: más bullicio al caer la tarde, calma de madrugada. */
export function trafficDensity(hour: number): number {
  const pts: [number, number][] = [[0, 0.4], [3, 0.15], [6, 0.35], [8, 0.85], [13, 0.7], [18.5, 1], [21, 0.75], [24, 0.4]];
  for (let i = 1; i < pts.length; i++) {
    const [h1, v1] = pts[i];
    const [h0, v0] = pts[i - 1];
    if (hour <= h1) return v0 + ((hour - h0) / (h1 - h0)) * (v1 - v0);
  }
  return 0.4;
}

export class City {
  /** Elementos estáticos en orden de dibujo (incluye el marcador del edificio de la habitación). */
  items: CityItem[] = [];
  private movers: Mover[] = [];
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
    const lamps: [number, number][] = [];
    const shops: { x: number; y: number; c: string }[] = [];

    for (let i = -RANGE; i <= RANGE; i++) {
      for (let j = -RANGE; j <= RANGE; j++) {
        const bx = i * PITCH, by = j * PITCH;
        // farolas en las esquinas y a mitad de cada acera (lado de la calzada)
        for (const [lx, ly] of [[bx - 0.55, by + BLOCK + 0.55], [bx + BLOCK + 0.55, by + BLOCK + 0.55], [bx + BLOCK + 0.55, by - 0.55], [bx + 4, by + BLOCK + 0.55], [bx + BLOCK + 0.55, by + 4]] as [number, number][]) {
          lamps.push([lx, ly]);
        }
        if (i === 0 && j === 0) continue; // tu edificio
        if (i === PARK[0] && j === PARK[1]) {
          this.park(items, bx, by, rnd);
          continue;
        }
        this.block(items, i, j, bx, by, rnd, shops);
      }
    }
    for (const [x, y] of lamps) items.push(this.lamp(x, y));
    // semáforos alrededor de tu manzana
    for (const [x, y, ph] of [[-0.5, -0.5, 0], [BLOCK + 0.5, -0.5, 1], [-0.5, BLOCK + 0.5, 1], [BLOCK + 0.5, BLOCK + 0.5, 0]] as [number, number, number][]) {
      items.push(this.signal(x, y, ph));
    }
    // marcador del edificio de la habitación (se dibuja aparte, en su sitio del orden)
    const tb: AABB = { x0: -WALL_T, y0: -WALL_T, x1: ROOM_SIZE, y1: ROOM_SIZE, z0: z0, z1: 3.2 };
    items.push({ kind: 'tower', box: tb, rect: boxRect(tb), fog: 0 });

    const vis = items.filter((it) => it.kind === 'tower' || overlap(it.rect, visible));
    this.items = sortItems(vis);
    for (const it of this.items) if (it.paint) it.sprite = this.sprite(it);
    this.towerIndex = this.items.findIndex((it) => it.kind === 'tower');
    this.buildGround(lamps, shops);
    this.buildMovers();
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

  private lamp(x: number, y: number): CityItem {
    const box: AABB = { x0: x - 0.08, y0: y - 0.08, x1: x + 0.08, y1: y + 0.08, z0: this.z0, z1: this.z0 + 1.45 };
    const z0 = this.z0;
    return {
      kind: 'lamp', box, rect: boxRect(box, 22), fog: this.fogFor(x, y),
      paint: (ctx) => {
        drawBox(ctx, x - 0.04, y - 0.04, z0, 0.08, 0.08, 1.35, '#3a3d55');
        const head = p(x, y, z0 + 1.38);
        const g = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 20);
        g.addColorStop(0, 'rgba(255,214,150,0.85)');
        g.addColorStop(0.25, 'rgba(255,190,110,0.35)');
        g.addColorStop(1, 'rgba(255,170,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(head[0] - 20, head[1] - 20, 40, 40);
        ctx.fillStyle = '#fff1cf';
        ctx.beginPath();
        ctx.arc(head[0], head[1], 2, 0, Math.PI * 2);
        ctx.fill();
      },
    };
  }

  private signal(x: number, y: number, ph: number): CityItem {
    const box: AABB = { x0: x - 0.07, y0: y - 0.07, x1: x + 0.07, y1: y + 0.07, z0: this.z0, z1: this.z0 + 1.2 };
    const z0 = this.z0;
    return {
      kind: 'signal', box, rect: boxRect(box, 8), fog: 0,
      paint: (ctx) => {
        drawBox(ctx, x - 0.035, y - 0.035, z0, 0.07, 0.07, 1.0, '#2c2f44');
        drawBox(ctx, x - 0.08, y - 0.06, z0 + 0.95, 0.16, 0.12, 0.3, '#1c1e2e');
      },
      dyn: (ctx, t) => {
        const green = Math.floor((t + ph * 7) / 7) % 2 === 0;
        const c = p(x, y + 0.07, z0 + (green ? 1.0 : 1.18));
        ctx.fillStyle = green ? '#6dffb0' : '#ff5a4f';
        ctx.beginPath();
        ctx.arc(c[0], c[1], 1.7, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 8);
        g.addColorStop(0, green ? 'rgba(109,255,176,0.5)' : 'rgba(255,90,79,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(c[0] - 8, c[1] - 8, 16, 16);
      },
    };
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

  private buildGround(lamps: [number, number][], shops: { x: number; y: number; c: string }[]) {
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
    // marcas viales (línea discontinua central)
    ctx.globalAlpha = 0.6;
    for (let g = -RANGE - 1; g <= RANGE; g++) {
      const mid = g * PITCH + BLOCK + STREET / 2;
      for (let u = MIN; u < MAX; u += 1.3) {
        quad(u, mid - 0.04, u + 0.6, mid + 0.04, '#3d4266');
        quad(mid - 0.04, u, mid + 0.04, u + 0.6, '#3d4266');
      }
    }
    ctx.globalAlpha = 1;
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
    // pasos de cebra alrededor de tu manzana
    const zebra = 'rgba(190,200,235,0.28)';
    for (const [sx, sy, along] of [[0, BLOCK + 0.8, 'x'], [0, -STREET + 0.8, 'x'], [BLOCK + 0.8, 0, 'y'], [-STREET + 0.8, 0, 'y']] as [number, number, 'x' | 'y'][]) {
      for (let s = 0; s < 8; s++) {
        if (along === 'x') quad(sx - 0.9, sy + s * 0.3, sx - 0.2, sy + s * 0.3 + 0.15, zebra);
        else quad(sx + s * 0.3, sy - 0.9, sx + s * 0.3 + 0.15, sy - 0.2, zebra);
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
    for (const [x, y] of lamps) pool(x, y, 58, '#ffb066', 0.28 * (1 - this.fogFor(x, y)));
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

  private buildMovers() {
    const rnd = mulberry32(99);
    const movers: Mover[] = [];
    for (let g = -RANGE - 1; g <= RANGE; g++) {
      const base = g * PITCH + BLOCK; // inicio de la banda de calle
      const lanes: [number, 1 | -1][] = [[base + SIDEWALK + 0.6, -1], [base + STREET - SIDEWALK - 0.6, 1]];
      for (const axis of ['x', 'y'] as const) {
        for (const [lane, dir] of lanes) {
          const n = 2 + Math.floor(rnd() * 2);
          for (let c = 0; c < n; c++) {
            movers.push({
              kind: 'car', axis, lane, dir, pos: MIN + rnd() * (MAX - MIN), speed: 1.4 + rnd() * 1.6,
              len: 0.95, wid: 0.46, color: shade(CARS[Math.floor(rnd() * CARS.length)], -0.35), rank: rnd(), visible: true,
            });
          }
        }
        // peatones por las aceras
        for (const [walk, dir] of [[base + 0.4, 1], [base + STREET - 0.4, -1], [base + 0.4, -1], [base + STREET - 0.4, 1]] as [number, 1 | -1][]) {
          if (rnd() < 0.3) continue;
          movers.push({
            kind: 'walker', axis, lane: walk, dir, pos: MIN + rnd() * (MAX - MIN), speed: 0.35 + rnd() * 0.25,
            len: 0.16, wid: 0.16, color: ['#3a3550', '#4a3f3a', '#2f3a52', '#5a3a4a'][Math.floor(rnd() * 4)], rank: rnd(), visible: true,
            umbrella: rnd() < 0.35 ? ['#c0533f', '#3f6fb0', '#d6a64a'][Math.floor(rnd() * 3)] : undefined,
          });
        }
      }
    }
    this.movers = movers;
  }

  update(dt: number, hour: number) {
    const dens = trafficDensity(hour);
    for (const m of this.movers) {
      m.pos += m.speed * m.dir * dt;
      let wrapped = false;
      if (m.pos > MAX) { m.pos = MIN; wrapped = true; }
      if (m.pos < MIN) { m.pos = MAX; wrapped = true; }
      if (wrapped || !m.visible) m.visible = m.rank < (m.kind === 'car' ? dens : dens * 0.9 + 0.1);
    }
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
    return { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, z0: this.z0, z1: this.z0 + (m.kind === 'car' ? 0.45 : 0.45) };
  }

  private drawMover(ctx: CanvasRenderingContext2D, m: Mover, b: AABB) {
    const z = this.z0;
    if (m.kind === 'walker') {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      drawBox(ctx, cx - 0.06, cy - 0.06, z, 0.12, 0.12, 0.3, m.color);
      const head = p(cx, cy, z + 0.36);
      ctx.fillStyle = '#c9a98a';
      ctx.beginPath();
      ctx.arc(head[0], head[1], 1.6, 0, Math.PI * 2);
      ctx.fill();
      if (m.umbrella) {
        const u = p(cx, cy, z + 0.5);
        ctx.fillStyle = shade(m.umbrella, -0.3);
        ctx.beginPath();
        ctx.ellipse(u[0], u[1], 7, 3.4, 0, Math.PI, 0);
        ctx.fill();
      }
      return;
    }
    // coche: chasis + cabina + faros
    const along = m.axis === 'x';
    const cabin = 0.5;
    drawBox(ctx, b.x0, b.y0, z + 0.06, b.x1 - b.x0, b.y1 - b.y0, 0.2, m.color);
    const cx0 = along ? b.x0 + (m.len - cabin) / 2 + (m.dir > 0 ? -0.06 : 0.06) : b.x0 + 0.05;
    const cy0 = along ? b.y0 + 0.05 : b.y0 + (m.len - cabin) / 2 + (m.dir > 0 ? -0.06 : 0.06);
    drawBox(ctx, cx0, cy0, z + 0.26, along ? cabin : m.wid - 0.1, along ? m.wid - 0.1 : cabin, 0.15, shade(m.color, 0.15));
    // ventanillas
    fillPoly(ctx, along
      ? [[cx0 + 0.05, b.y1 - 0.049, z + 0.29], [cx0 + cabin - 0.05, b.y1 - 0.049, z + 0.29], [cx0 + cabin - 0.05, b.y1 - 0.049, z + 0.39], [cx0 + 0.05, b.y1 - 0.049, z + 0.39]]
      : [[b.x1 - 0.049, cy0 + 0.05, z + 0.29], [b.x1 - 0.049, cy0 + cabin - 0.05, z + 0.29], [b.x1 - 0.049, cy0 + cabin - 0.05, z + 0.39], [b.x1 - 0.049, cy0 + 0.05, z + 0.39]], '#1a2036');
    // faros (delante) y pilotos (detrás)
    const front = m.dir > 0 ? (along ? b.x1 : b.y1) : (along ? b.x0 : b.y0);
    const back = m.dir > 0 ? (along ? b.x0 : b.y0) : (along ? b.x1 : b.y1);
    const side = (k: number) => (along ? b.y0 + k * (b.y1 - b.y0) : b.x0 + k * (b.x1 - b.x0));
    for (const k of [0.25, 0.75]) {
      const f = along ? p(front, side(k), z + 0.17) : p(side(k), front, z + 0.17);
      const r = along ? p(back, side(k), z + 0.17) : p(side(k), back, z + 0.17);
      ctx.fillStyle = '#fff6dc';
      ctx.fillRect(f[0] - 1, f[1] - 1, 2.2, 2.2);
      ctx.fillStyle = '#ff4a4a';
      ctx.fillRect(r[0] - 1, r[1] - 1, 2, 2);
    }
    // haz de luz sobre el asfalto
    const tip = front + m.dir * 2.4;
    const poly: P3[] = along
      ? [[front, b.y0 + 0.05, z], [tip, b.y0 - 0.35, z], [tip, b.y1 + 0.35, z], [front, b.y1 - 0.05, z]]
      : [[b.x0 + 0.05, front, z], [b.x0 - 0.35, tip, z], [b.x1 + 0.35, tip, z], [b.x1 - 0.05, front, z]];
    const a0 = p(...poly[0]), a1 = p(...poly[1]);
    const g = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
    g.addColorStop(0, 'rgba(255,240,200,0.32)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    pathPoly(ctx, poly);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
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
    for (const m of this.movers) {
      if (!m.visible) continue;
      const b = this.moverBox(m);
      // la caja de repintado incluye el haz de los faros (2,4 u por delante del coche)
      const reach = m.kind === 'car' ? 2.6 : 0;
      const ext: AABB = m.axis === 'x'
        ? { ...b, x0: Math.min(b.x0, b.x0 + reach * m.dir), x1: Math.max(b.x1, b.x1 + reach * m.dir), y0: b.y0 - 0.4, y1: b.y1 + 0.4 }
        : { ...b, y0: Math.min(b.y0, b.y0 + reach * m.dir), y1: Math.max(b.y1, b.y1 + reach * m.dir), x0: b.x0 - 0.4, x1: b.x1 + 0.4 };
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
        if (!it.dyn) continue;
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
