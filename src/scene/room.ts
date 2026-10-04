// Definición del cuarto: suelo, losa del diorama y paredes (con hueco de ventana).
import { fillPoly, p, pathPoly, type P2, type P3 } from '../engine/iso';
import { rgba, shade } from '../engine/color';
import { mulberry32 } from '../engine/random';
import { MAT } from './palette';

export const ROOM_SIZE = 8;
export const WALL_H = 3;
export const WALL_T = 0.22;
export const SLAB = 0.45;

/** Hueco de la ventana en la pared derecha (plano y = 0). */
export const WINDOW = { x0: 1.7, x1: 4.5, z0: 0.95, z1: 2.6 };

/** Altura del friso de las paredes: la moldura queda justo bajo el alféizar de la ventana. */
export const WAINSCOT = 0.88;

/** Polígono del hueco de la ventana (en el plano interior de la pared). */
export function windowHole(): P3[] {
  const { x0, x1, z0, z1 } = WINDOW;
  return [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
}

/** Rellena un polígono del mundo con un degradado lineal entre dos puntos del mundo. */
export function gradPoly(ctx: CanvasRenderingContext2D, pts: P3[], from: P3, to: P3, stops: [number, string][]) {
  const a = p(from[0], from[1], from[2]), b = p(to[0], to[1], to[2]);
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  for (const [o, c] of stops) g.addColorStop(o, c);
  pathPoly(ctx, pts);
  ctx.fillStyle = g;
  ctx.fill();
}

/** Traza una polilínea de puntos del mundo (sin cerrar). */
export function strokePoly(ctx: CanvasRenderingContext2D, pts: P3[], color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const [sx, sy] = p(pt[0], pt[1], pt[2]);
    if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
  });
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Capas estáticas en caché
//
// El suelo y las paredes no cambian entre fotogramas, pero el cuarto se repinta entero cada vez.
// Cada capa se renderiza una vez a la resolución actual y después se copia con un solo drawImage,
// alineada al píxel para que sea idéntica a dibujarla directamente.

/** Envolvente del suelo y las paredes en px isométricos (con margen para trazos y canto de la nieve). */
const SHELL = { x: -268, y: -108, w: 536, h: 386 };

const layers = new Map<string, { key: string; canvas: HTMLCanvasElement }>();

function drawCached(ctx: CanvasRenderingContext2D, id: string, draw: (c: CanvasRenderingContext2D) => void) {
  const m = ctx.getTransform();
  // Solo con escala uniforme y sin giros; en cualquier otro caso, se dibuja directamente.
  if (Math.abs(m.a - m.d) > 1e-6 || m.b !== 0 || m.c !== 0) {
    draw(ctx);
    return;
  }
  const k = m.a;
  const ix = Math.floor(m.e + SHELL.x * k), iy = Math.floor(m.f + SHELL.y * k);
  const ox = m.e - ix, oy = m.f - iy; // posición del origen del mundo dentro de la capa
  const key = `${k}|${ox.toFixed(3)}|${oy.toFixed(3)}`;
  let layer = layers.get(id);
  if (!layer || layer.key !== key) {
    const canvas = layer?.canvas ?? document.createElement('canvas');
    canvas.width = Math.ceil(SHELL.w * k) + 2;
    canvas.height = Math.ceil(SHELL.h * k) + 2;
    const c = canvas.getContext('2d')!;
    c.setTransform(k, 0, 0, k, ox, oy);
    draw(c);
    layer = { key, canvas };
    layers.set(id, layer);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, ix, iy);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Suelo

const PLANK = 0.5;

interface Board {
  y: number;
  x0: number;
  x1: number;
  tone: string;
  /** Vetas: [desplazamiento en y, x inicial, x final]. */
  grain: [number, number, number][];
  knot?: [number, number];
}

/** Tarimas con juntas escalonadas, tono propio y vetas (arte determinista, se calcula una vez). */
const BOARDS: Board[] = (() => {
  const rnd = mulberry32(2024);
  const S = ROOM_SIZE;
  const out: Board[] = [];
  const rows = Math.round(S / PLANK);
  for (let r = 0; r < rows; r++) {
    const y = r * PLANK;
    let x = 0;
    let len = 0.9 + rnd() * 2.2;
    while (x < S - 1e-6) {
      let x1 = Math.min(S, x + len);
      if (S - x1 < 0.8) x1 = S; // sin tablas de remate diminutas
      const base = rnd() < 0.5 ? MAT.floorA : MAT.floorB;
      const tone = shade(base, (rnd() - 0.5) * 0.18);
      const span = x1 - x;
      const grain: [number, number, number][] = [];
      const n = 2 + (rnd() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        grain.push([0.1 + rnd() * 0.3, x + rnd() * span * 0.35, x1 - rnd() * span * 0.35]);
      }
      const knot: [number, number] | undefined = rnd() < 0.09 && span > 1.5 ? [x + span * (0.25 + rnd() * 0.5), y + 0.15 + rnd() * 0.2] : undefined;
      out.push({ y, x0: x, x1, tone, grain, knot });
      x = x1;
      len = 1.7 + rnd() * 2.3;
    }
  }
  return out;
})();

export function drawFloor(ctx: CanvasRenderingContext2D) {
  drawCached(ctx, 'floor', paintFloor);
}

function paintFloor(ctx: CanvasRenderingContext2D) {
  const S = ROOM_SIZE;
  // Losa: caras frontales con degradado y un canto más claro que marca el borde del suelo
  gradPoly(ctx, [[-WALL_T, S, -SLAB], [S, S, -SLAB], [S, S, 0], [-WALL_T, S, 0]], [0, S, -SLAB], [0, S, 0], [[0, shade(MAT.slabLeft, -0.25)], [1, MAT.slabLeft]]);
  gradPoly(ctx, [[S, -WALL_T, -SLAB], [S, S, -SLAB], [S, S, 0], [S, -WALL_T, 0]], [S, 0, -SLAB], [S, 0, 0], [[0, shade(MAT.slabRight, -0.25)], [1, MAT.slabRight]]);
  fillPoly(ctx, [[-WALL_T, S, -0.07], [S, S, -0.07], [S, S, 0], [-WALL_T, S, 0]], shade(MAT.slabLeft, 0.22));
  fillPoly(ctx, [[S, -WALL_T, -0.07], [S, S, -0.07], [S, S, 0], [S, -WALL_T, 0]], shade(MAT.slabRight, 0.22));

  // Tarimas
  for (const b of BOARDS) {
    fillPoly(ctx, [[b.x0, b.y, 0], [b.x1, b.y, 0], [b.x1, b.y + PLANK, 0], [b.x0, b.y + PLANK, 0]], b.tone);
  }

  ctx.save();
  ctx.lineCap = 'butt';
  // Juntas: la unión de cada hilera y los testeros escalonados
  ctx.strokeStyle = rgba(MAT.floorLine, 0.75);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let j = PLANK; j < S - 1e-6; j += PLANK) {
    const s = p(0, j), e = p(S, j);
    ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]);
  }
  for (const b of BOARDS) {
    if (b.x0 <= 0) continue;
    const u = p(b.x0, b.y), v = p(b.x0, b.y + PLANK);
    ctx.moveTo(u[0], u[1]); ctx.lineTo(v[0], v[1]);
  }
  ctx.stroke();
  // Bisel iluminado en el canto que mira a la ventana
  ctx.strokeStyle = 'rgba(255,240,215,0.2)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const b of BOARDS) {
    const u = p(b.x0 + 0.04, b.y + 0.035), v = p(b.x1 - 0.04, b.y + 0.035);
    ctx.moveTo(u[0], u[1]); ctx.lineTo(v[0], v[1]);
  }
  ctx.stroke();
  // Vetas
  ctx.strokeStyle = 'rgba(58,34,20,0.13)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const b of BOARDS) {
    for (const [o, a, c] of b.grain) {
      const u = p(a, b.y + o), v = p(c, b.y + o);
      ctx.moveTo(u[0], u[1]); ctx.lineTo(v[0], v[1]);
    }
  }
  ctx.stroke();
  // Nudos
  for (const b of BOARDS) {
    if (!b.knot) continue;
    const [sx, sy] = p(b.knot[0], b.knot[1]);
    ctx.fillStyle = 'rgba(62,36,20,0.24)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.6, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(62,36,20,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 4.6, 2.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Reflejo de la luz de la ventana (desde el fondo derecho) y caída hacia la esquina delantera
  const floor: P3[] = [[0, 0, 0], [S, 0, 0], [S, S, 0], [0, S, 0]];
  gradPoly(ctx, floor, [S * 0.75, 0, 0], [S * 0.12, S, 0], [
    [0, 'rgba(255,236,205,0.11)'],
    [0.5, 'rgba(255,236,205,0)'],
    [1, 'rgba(8,6,28,0.16)'],
  ]);
  // Oclusión ambiental al pie de las paredes
  gradPoly(ctx, [[0, 0, 0], [0.9, 0, 0], [0.9, S, 0], [0, S, 0]], [0, 4, 0], [0.9, 4, 0], [[0, 'rgba(6,6,24,0.34)'], [1, 'rgba(6,6,24,0)']]);
  gradPoly(ctx, [[0, 0, 0], [S, 0, 0], [S, 0.9, 0], [0, 0.9, 0]], [4, 0, 0], [4, 0.9, 0], [[0, 'rgba(6,6,24,0.34)'], [1, 'rgba(6,6,24,0)']]);

  // Borde superior de la losa
  ctx.strokeStyle = rgba(shade(MAT.floorA, 0.3), 0.75);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const d = p(0, S), e = p(S, S), f = p(S, 0);
  ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(f[0], f[1]);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Paredes

function vGradient(ctx: CanvasRenderingContext2D, zLow: P2, zHigh: P2, cLow: string, cHigh: string) {
  const g = ctx.createLinearGradient(zLow[0], zLow[1], zHigh[0], zHigh[1]);
  g.addColorStop(0, cLow);
  g.addColorStop(1, cHigh);
  return g;
}

type Wall = 'L' | 'R';

/** Punto de la pared: u recorre la pared (y en la izquierda, x en la derecha), z es la altura. */
const wallPt = (wall: Wall, u: number, z: number, off = 0): P3 => (wall === 'L' ? [off, u, z] : [u, off, z]);
const wallQuad = (wall: Wall, u0: number, u1: number, z0: number, z1: number, off = 0): P3[] => [
  wallPt(wall, u0, z0, off), wallPt(wall, u1, z0, off), wallPt(wall, u1, z1, off), wallPt(wall, u0, z1, off),
];

/** Friso con paneles, moldura, zócalo, rayas de papel pintado y oclusión en la esquina. */
function drawWallDetail(ctx: CanvasRenderingContext2D, wall: Wall) {
  const S = ROOM_SIZE, H = WALL_H, W = WAINSCOT;
  const { x0, x1, z0, z1 } = WINDOW;
  const baseboard = wall === 'L' ? MAT.baseboard : shade(MAT.baseboard, 0.08);

  // Papel pintado: rayas verticales apenas insinuadas (se interrumpen en el hueco de la ventana)
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let u = 0.3; u < S; u += 0.56) {
    const segs: [number, number][] = wall === 'R' && u > x0 - 0.1 && u < x1 + 0.1 ? [[W + 0.08, z0], [z1, H]] : [[W + 0.08, H]];
    for (const [a, b] of segs) {
      const s = p(...wallPt(wall, u, a)), e = p(...wallPt(wall, u, b));
      ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]);
    }
  }
  ctx.stroke();

  // Friso: tono algo más profundo bajo la moldura
  fillPoly(ctx, wallQuad(wall, 0, S, 0.14, W, 0.005), 'rgba(22,24,64,0.2)');
  const n = 4, gap = 0.2, margin = 0.32;
  const pw = (S - margin * 2 - gap * (n - 1)) / n;
  const pz0 = 0.26, pz1 = W - 0.12;
  for (let i = 0; i < n; i++) {
    const u0 = margin + i * (pw + gap), u1 = u0 + pw;
    fillPoly(ctx, wallQuad(wall, u0, u1, pz0, pz1, 0.006), 'rgba(255,255,255,0.045)');
    // luz arriba y en el canto de la izquierda de la pantalla; sombra abajo y en el otro
    const lit = wall === 'L' ? u1 : u0, dark = wall === 'L' ? u0 : u1;
    strokePoly(ctx, [wallPt(wall, lit, pz0, 0.007), wallPt(wall, lit, pz1, 0.007), wallPt(wall, dark, pz1, 0.007)], 'rgba(255,255,255,0.22)', 0.8);
    strokePoly(ctx, [wallPt(wall, lit, pz0, 0.007), wallPt(wall, dark, pz0, 0.007), wallPt(wall, dark, pz1, 0.007)], 'rgba(8,8,30,0.32)', 0.8);
  }
  // Moldura superior del friso: cara iluminada y sombra que proyecta
  fillPoly(ctx, wallQuad(wall, 0, S, W - 0.1, W - 0.035, 0.006), 'rgba(8,8,30,0.2)');
  fillPoly(ctx, wallQuad(wall, 0, S, W - 0.035, W + 0.05, 0.01), shade(wall === 'L' ? MAT.wallLeft : MAT.wallRight, 0.28));
  fillPoly(ctx, wallQuad(wall, 0, S, W + 0.05, W + 0.075, 0.01), 'rgba(255,255,255,0.18)');

  // Zócalo con canto iluminado
  fillPoly(ctx, wallQuad(wall, 0, S, 0, 0.16, 0.02), baseboard);
  fillPoly(ctx, wallQuad(wall, 0, S, 0.145, 0.16, 0.021), 'rgba(255,255,255,0.28)');
  fillPoly(ctx, wallQuad(wall, 0, S, 0.16, 0.2, 0.005), 'rgba(8,8,30,0.16)');

  // Oclusión ambiental en la esquina interior
  const far: P3 = wallPt(wall, 1.0, H / 2), near: P3 = wallPt(wall, 0, H / 2);
  gradPoly(ctx, wallQuad(wall, 0, 1.0, 0, H, 0.004), near, far, [[0, 'rgba(8,8,28,0.34)'], [1, 'rgba(8,8,28,0)']]);
  // y un velo bajo el borde superior, donde la pared recibe menos luz de la sala
  gradPoly(ctx, wallQuad(wall, 0, S, H - 0.35, H, 0.004), wallPt(wall, 4, H), wallPt(wall, 4, H - 0.35), [[0, 'rgba(8,8,28,0.12)'], [1, 'rgba(8,8,28,0)']]);
}

export function drawWalls(ctx: CanvasRenderingContext2D) {
  drawCached(ctx, 'walls', paintWalls);
}

function paintWalls(ctx: CanvasRenderingContext2D) {
  const S = ROOM_SIZE, H = WALL_H, T = WALL_T;

  // --- Pared izquierda (plano x = 0), cara interior
  pathPoly(ctx, [[0, 0, 0], [0, S, 0], [0, S, H], [0, 0, H]]);
  ctx.fillStyle = vGradient(ctx, p(0, 4, 0), p(0, 4, H), shade(MAT.wallLeft, -0.12), MAT.wallLeft);
  ctx.fill();
  drawWallDetail(ctx, 'L');

  // --- Pared derecha (plano y = 0), cara interior con hueco de ventana
  const hole = windowHole();
  ctx.beginPath();
  const outer: P3[] = [[0, 0, 0], [S, 0, 0], [S, 0, H], [0, 0, H]];
  for (const poly of [outer, hole.slice().reverse()]) {
    poly.forEach((pt, i) => {
      const [sx, sy] = p(pt[0], pt[1], pt[2]);
      if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
  }
  ctx.fillStyle = vGradient(ctx, p(4, 0, 0), p(4, 0, H), shade(MAT.wallRight, -0.12), MAT.wallRight);
  ctx.fill('evenodd');
  drawWallDetail(ctx, 'R');

  // Esquina interior: línea de sombra
  ctx.strokeStyle = 'rgba(10,12,30,0.3)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  const c0 = p(0, 0, 0), c1 = p(0, 0, H);
  ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]);
  ctx.stroke();

  // Grosor del hueco de la ventana: alféizar inferior y lateral izquierdo
  const { x0, x1, z0, z1 } = WINDOW;
  fillPoly(ctx, [[x0, -T, z0], [x1, -T, z0], [x1, 0, z0], [x0, 0, z0]], shade(MAT.wallRight, 0.1));
  fillPoly(ctx, [[x0, -T, z0], [x0, 0, z0], [x0, 0, z1], [x0, -T, z1]], shade(MAT.wallRight, -0.35));

  // --- Cantos frontales (losa incluida) y tapas con nieve
  fillPoly(ctx, [[-T, S, -SLAB], [0, S, -SLAB], [0, S, H], [-T, S, H]], MAT.wallEnd);
  fillPoly(ctx, [[S, -T, -SLAB], [S, 0, -SLAB], [S, 0, H], [S, -T, H]], shade(MAT.wallEnd, -0.2));
  fillPoly(ctx, [[-T, -T, H], [0, -T, H], [0, S, H], [-T, S, H]], MAT.wallCap);
  fillPoly(ctx, [[0, -T, H], [S, -T, H], [S, 0, H], [0, 0, H]], MAT.wallCap);
  // ligero "colchón" de nieve que sobresale
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const s1 = p(0, S, H), s2 = p(0, 0, H), s3 = p(S, 0, H);
  ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.lineTo(s3[0], s3[1]);
  ctx.stroke();
  // brillo en los cantos verticales de las paredes
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const e0 = p(-T, S, H), e1 = p(-T, S, -SLAB), g0 = p(S, -T, H), g1 = p(S, -T, -SLAB);
  ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]);
  ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]);
  ctx.stroke();
}
