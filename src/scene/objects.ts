// Catálogo de objetos de la escena y su arte procedural.
import { drawBox, drawCylinder, fillPoly, p, depthKey, type P2 } from '../engine/iso';
import { rgba, shade } from '../engine/color';
import type { ObjectId, PillarId } from '../game/state';
import { BOOK_COLORS, MAT, blanketColor } from './palette';
import { WINDOW, WALL_T } from './room';

export interface Box { x: number; y: number; z: number; w: number; d: number; h: number }

/** Lo que la escena necesita saber del juego para dibujarse. */
export interface SceneEnv {
  level: number; // 1..10
  t: number; // segundos
  meters: Record<PillarId, number>; // 0..1
  goals: { text: string; done: boolean }[];
  bossDecor: number | null; // decoración temporal del reto semanal
  timerRunning: boolean;
  journalToday: boolean;
  reducedMotion: boolean;
}

export interface SceneObject {
  id: string;
  /** Objeto clicable (vinculado a un pilar o función). */
  target?: ObjectId;
  label?: string;
  /** 'wall': colgado de pared (se dibuja antes); 'floor': calcomanía de suelo; 'object': ordenado por profundidad. */
  layer: 'wall' | 'floor' | 'object';
  box: Box;
  visible?: (env: SceneEnv) => boolean;
  draw: (ctx: CanvasRenderingContext2D, env: SceneEnv) => void;
}

// ---------------------------------------------------------------------------
// Helpers de planos

const quadX = (ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, z0: number, z1: number, c: string) =>
  fillPoly(ctx, [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], c);
const quadY = (ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number, z0: number, z1: number, c: string) =>
  fillPoly(ctx, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], c);
const quadZ = (ctx: CanvasRenderingContext2D, z: number, x0: number, x1: number, y0: number, y1: number, c: string) =>
  fillPoly(ctx, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], c);

function line(ctx: CanvasRenderingContext2D, a: P2, b: P2, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, at: P2, r: number, color: string | CanvasGradient) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx: CanvasRenderingContext2D, at: P2, len: number, wid: number, angle: number, color: string) {
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fill();
  ctx.strokeStyle = rgba(shade(color, -0.35), 0.6);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.85, 0);
  ctx.stroke();
  ctx.restore();
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Estantería (Mente)

interface Book { w: number; h: number; c: string; lean: number }
const SHELF_BOOKS: Book[][] = (() => {
  const rnd = mulberry32(42);
  return [0, 1, 2, 3].map(() =>
    Array.from({ length: 9 }, () => ({
      w: 0.11 + rnd() * 0.08,
      h: 0.3 + rnd() * 0.18,
      c: BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)],
      lean: rnd(),
    })),
  );
})();

function booksVisible(level: number, shelf: number): number {
  const tables = [
    [2, 1, 0, 1], // nivel 1-3
    [5, 4, 3, 2], // 4-8
    [8, 7, 6, 6], // 9-10
  ];
  const row = level >= 9 ? 2 : level >= 4 ? 1 : 0;
  return tables[row][shelf];
}

function drawShelf(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const X = 0, Y = 0.9, W = 0.85, D = 2.1, H = 2.4;
  const wood = MAT.wood;
  drawBox(ctx, X, Y, 0, 0.08, D, H, shade(wood, -0.25));
  drawBox(ctx, X + 0.08, Y, 0, W - 0.08, 0.07, H, wood);
  const levels = [0.0, 0.6, 1.2, 1.8];
  levels.forEach((zb, i) => {
    drawBox(ctx, X + 0.08, Y + 0.07, zb, W - 0.08, D - 0.14, 0.06, wood);
    const n = booksVisible(env.level, i);
    let y = Y + 0.12;
    const books = SHELF_BOOKS[i];
    for (let k = 0; k < n && k < books.length; k++) {
      const b = books[k];
      drawBox(ctx, X + 0.18, y, zb + 0.06, 0.55, b.w, b.h, b.c);
      // lomo: franja clara
      quadX(ctx, X + 0.731, y + 0.02, y + b.w - 0.02, zb + 0.06 + b.h * 0.65, zb + 0.06 + b.h * 0.72, rgba('#ffffff', 0.35));
      y += b.w + 0.01;
    }
    // pila de libros tumbados (desorden en niveles bajos, decoración después)
    if (i === 2 && env.level < 4) {
      drawBox(ctx, X + 0.2, Y + 1.2, zb + 0.06, 0.5, 0.55, 0.07, BOOK_COLORS[1]);
      drawBox(ctx, X + 0.24, Y + 1.25, zb + 0.13, 0.45, 0.5, 0.06, BOOK_COLORS[3]);
    }
    if (i === 3 && env.level >= 4) {
      // jarrón pequeño
      drawCylinder(ctx, X + 0.45, Y + 1.75, zb + 0.06, 0.09, 0.25, '#7fb3c9');
    }
  });
  drawBox(ctx, X + 0.08, Y + 0.07, H - 0.06, W - 0.08, D - 0.14, 0.06, shade(wood, 0.05));
  drawBox(ctx, X + 0.08, Y + D - 0.07, 0, W - 0.08, 0.07, H, wood);
  // decoración del reto semanal sobre la estantería
  if (env.bossDecor !== null) drawBossDecor(ctx, env.bossDecor, X + 0.42, Y + 1.0, H, env.t);
}

function drawBossDecor(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, z: number, t: number) {
  switch (kind % 4) {
    case 0: { // trofeo
      drawBox(ctx, x - 0.12, y - 0.12, z, 0.24, 0.24, 0.08, '#6e4f3b');
      drawCylinder(ctx, x, y, z + 0.08, 0.04, 0.12, '#e3b04b');
      drawCylinder(ctx, x, y, z + 0.2, 0.12, 0.16, '#f2c45a');
      break;
    }
    case 1: { // bola de nieve
      drawBox(ctx, x - 0.13, y - 0.13, z, 0.26, 0.26, 0.08, '#5a3f30');
      const c = p(x, y, z + 0.24);
      const g = ctx.createRadialGradient(c[0] - 3, c[1] - 3, 1, c[0], c[1], 9);
      g.addColorStop(0, 'rgba(230,245,255,0.95)');
      g.addColorStop(1, 'rgba(127,214,255,0.45)');
      dot(ctx, c, 8.5, g);
      for (let i = 0; i < 5; i++) dot(ctx, [c[0] + Math.sin(t + i * 2) * 4, c[1] + ((t * 3 + i * 3) % 10) - 5], 0.8, '#fff');
      break;
    }
    case 2: { // vela
      drawCylinder(ctx, x, y, z, 0.1, 0.22, '#efe3cf');
      const f = p(x, y, z + 0.3);
      dot(ctx, f, 2.2 + Math.sin(t * 9) * 0.3, '#ffd98a');
      break;
    }
    default: { // banderín
      line(ctx, p(x, y, z), p(x, y, z + 0.5), '#3a3a4a', 1.2);
      fillPoly(ctx, [[x, y, z + 0.5], [x, y + 0.3, z + 0.42], [x, y, z + 0.34]], '#ffb347');
    }
  }
}

// ---------------------------------------------------------------------------
// Corcho de metas (pared izquierda)

const CORK = { y0: 3.25, y1: 5.05, z0: 1.05, z1: 2.25 };

function drawCorkboard(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const { y0, y1, z0, z1 } = CORK;
  drawBox(ctx, 0, y0, z0, 0.06, y1 - y0, z1 - z0, MAT.woodDark);
  quadX(ctx, 0.061, y0 + 0.07, y1 - 0.07, z0 + 0.07, z1 - 0.07, MAT.cork);
  // notas: metas del arco primero, luego notas genéricas según nivel
  const extra = env.level >= 7 ? 4 : env.level >= 4 ? 2 : 1;
  const slots = Math.min(8, env.goals.length + extra);
  const cols = 4;
  const colors = ['#ffe08a', '#ffb3a7', '#a8e0c8', '#a9c8ff'];
  const pins: P2[] = [];
  for (let i = 0; i < slots; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const yy = y0 + 0.16 + col * 0.42;
    const zz = z1 - 0.2 - row * 0.5;
    const isGoal = i < env.goals.length;
    const c = isGoal ? '#fff3c4' : colors[i % colors.length];
    quadX(ctx, 0.07, yy, yy + 0.3, zz - 0.3, zz, c);
    // "texto"
    for (let k = 0; k < 3; k++) {
      quadX(ctx, 0.071, yy + 0.04, yy + 0.26 - k * 0.05, zz - 0.08 - k * 0.07, zz - 0.06 - k * 0.07, rgba('#5a4a3a', 0.45));
    }
    if (isGoal && env.goals[i].done) {
      // check verde
      const a = p(0.075, yy + 0.06, zz - 0.17), b = p(0.075, yy + 0.12, zz - 0.25), c2 = p(0.075, yy + 0.25, zz - 0.05);
      ctx.strokeStyle = '#3aa565';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]);
      ctx.stroke();
    }
    const pin = p(0.08, yy + 0.15, zz - 0.03);
    pins.push(pin);
    dot(ctx, pin, 1.6, isGoal ? '#e0433a' : '#3a7be0');
  }
  if (env.level >= 7 && pins.length > 2) {
    ctx.strokeStyle = 'rgba(200,40,40,0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    pins.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Ventana (Reflexión / diario)

function drawWindow(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const { x0, x1, z0, z1 } = WINDOW;
  // cristal: tinte muy leve + reflejos
  quadY(ctx, -0.02, x0, x1, z0, z1, 'rgba(127,214,255,0.07)');
  ctx.save();
  ctx.globalAlpha = 0.18;
  fillPoly(ctx, [[x0 + 0.3, -0.02, z1], [x0 + 0.65, -0.02, z1], [x0 + 0.15, -0.02, z0], [x0 - 0.0, -0.02, z0 + 0.25]], '#dff3ff');
  fillPoly(ctx, [[x0 + 1.75, -0.02, z1], [x0 + 1.85, -0.02, z1], [x0 + 1.35, -0.02, z0], [x0 + 1.25, -0.02, z0]], '#dff3ff');
  ctx.restore();
  // marco
  const f = 0.07, frame = '#d7dbea';
  quadY(ctx, 0.0, x0, x1, z1 - f, z1, frame);
  quadY(ctx, 0.0, x0, x1, z0, z0 + f, frame);
  quadY(ctx, 0.0, x0, x0 + f, z0, z1, frame);
  quadY(ctx, 0.0, x1 - f, x1, z0, z1, frame);
  const mx = (x0 + x1) / 2;
  quadY(ctx, 0.0, mx - 0.03, mx + 0.03, z0, z1, frame);
  quadY(ctx, 0.0, x0, x1, (z0 + z1) / 2 - 0.025, (z0 + z1) / 2 + 0.025, frame);
  // alféizar interior
  drawBox(ctx, x0 - 0.12, 0, z0 - 0.07, x1 - x0 + 0.24, 0.2, 0.07, '#e4e6f0');
  // vela/farolillo en el alféizar (nivel 3+)
  if (env.level >= 3) {
    drawBox(ctx, x1 - 0.45, 0.04, z0, 0.16, 0.12, 0.2, '#f3e2c4');
    dot(ctx, p(x1 - 0.37, 0.1, z0 + 0.1), 1.6, '#fff1c9');
  }
  // diario de hoy escrito → libreta en el alféizar
  if (env.journalToday) drawBox(ctx, x0 + 0.15, 0.03, z0, 0.42, 0.14, 0.04, '#c9574b');
  // guirnalda de la ventana (nivel 3+)
  if (env.level >= 3) {
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const xx = x0 + 0.05 + (i / n) * (x1 - x0 - 0.1);
      const sag = Math.sin((i / n) * Math.PI) * 0.12;
      const on = env.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(env.t * 2 + i * 1.7);
      dot(ctx, p(xx, 0.06, z1 - 0.06 - sag), 1.5, rgba('#ffd98a', on));
    }
  }
  // cortinas (nivel 9+)
  if (env.level >= 9) {
    const c = MAT.curtain;
    line(ctx, p(x0 - 0.35, 0.08, z1 + 0.14), p(x1 + 0.35, 0.08, z1 + 0.14), '#3b2f2a', 1.6);
    for (const [a, b] of [[x0 - 0.35, x0 + 0.35], [x1 - 0.35, x1 + 0.35]]) {
      const folds = 4;
      for (let k = 0; k < folds; k++) {
        const u0 = a + (k / folds) * (b - a), u1 = a + ((k + 1) / folds) * (b - a);
        quadY(ctx, 0.08, u0, u1, z0 - 0.35, z1 + 0.12, k % 2 ? c : shade(c, -0.18));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cama (Sueño)

function drawBed(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  // mesilla + lámpara
  drawBox(ctx, 0.05, 4.95, 0, 0.6, 0.62, 0.5, MAT.wood);
  quadY(ctx, 5.571, 0.12, 0.58, 0.28, 0.3, rgba('#2a1c14', 0.6));
  dot(ctx, p(0.35, 5.571, 0.37), 0.9, '#d9b98a');
  drawCylinder(ctx, 0.33, 5.25, 0.5, 0.08, 0.2, '#c9c3b5');
  // pantalla (trapecio)
  const lit = env.level >= 8;
  const shadeCol = lit ? '#ffe2a6' : '#b9b3a6';
  const a = p(0.33, 5.25, 0.7), b = p(0.33, 5.25, 0.98);
  ctx.fillStyle = shadeCol;
  ctx.beginPath();
  ctx.moveTo(a[0] - 9, a[1]);
  ctx.lineTo(a[0] + 9, a[1]);
  ctx.lineTo(b[0] + 6, b[1]);
  ctx.lineTo(b[0] - 6, b[1]);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#000000', 0.12);
  ctx.beginPath();
  ctx.ellipse(b[0], b[1], 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // cabecero
  drawBox(ctx, 0, 5.65, 0, 0.16, 2.0, 1.05, MAT.woodDark);
  // estructura
  drawBox(ctx, 0.16, 5.7, 0, 2.55, 1.9, 0.3, MAT.woodDark);
  // colchón
  drawBox(ctx, 0.2, 5.74, 0.3, 2.47, 1.82, 0.2, MAT.white);
  const made = env.level >= 3;
  if (made) {
    drawBox(ctx, 0.3, 5.95, 0.5, 0.5, 1.4, 0.12, '#f7f5fb');
    const bc = blanketColor(env.level);
    // manta: superficie + caída por los lados visibles
    drawBox(ctx, 0.95, 5.72, 0.5, 1.75, 1.86, 0.05, bc);
    quadY(ctx, 7.58, 0.95, 2.7, 0.18, 0.5, shade(bc, -0.3));
    quadX(ctx, 2.7, 5.72, 7.58, 0.18, 0.5, shade(bc, -0.45));
    // embozo
    drawBox(ctx, 0.95, 5.72, 0.55, 0.22, 1.86, 0.03, '#f2eef8');
    // cojín decorativo
    if (env.level >= 6) drawBox(ctx, 0.45, 6.6, 0.62, 0.3, 0.5, 0.18, '#e0a85a');
  } else {
    // manta arrugada
    drawBox(ctx, 0.7, 6.4, 0.5, 0.42, 0.6, 0.06, '#f2f0f8');
    drawBox(ctx, 1.0, 5.85, 0.5, 1.2, 1.1, 0.1, '#7f8399');
    drawBox(ctx, 1.4, 6.6, 0.5, 1.05, 0.95, 0.14, '#8b8fa5');
    drawBox(ctx, 1.25, 6.2, 0.6, 0.6, 0.6, 0.1, '#959ab0');
    quadY(ctx, 7.56, 1.5, 2.4, 0.2, 0.5, '#6c7088');
  }
}

// ---------------------------------------------------------------------------
// Escritorio (Foco)

function drawDesk(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  // patas laterales
  drawBox(ctx, 5.08, 0.06, 0, 0.08, 1.08, 0.75, MAT.metal);
  drawBox(ctx, 7.72, 0.06, 0, 0.08, 1.08, 0.75, MAT.metal);
  drawBox(ctx, 5.16, 0.08, 0.5, 2.56, 0.05, 0.2, shade(MAT.metal, -0.2));
  // tablero
  drawBox(ctx, 5.0, 0.0, 0.75, 2.9, 1.2, 0.07, MAT.woodLight);
  // monitor
  drawBox(ctx, 6.2, 0.18, 0.82, 0.4, 0.28, 0.02, MAT.dark);
  drawBox(ctx, 6.36, 0.2, 0.84, 0.08, 0.06, 0.22, MAT.dark);
  drawBox(ctx, 5.75, 0.12, 0.98, 1.3, 0.08, 0.72, MAT.dark);
  const scr = env.meters.foco > 0.6 ? '#5fb6e6' : MAT.screen;
  quadY(ctx, 0.201, 5.8, 7.0, 1.03, 1.66, scr);
  // "código" en pantalla
  for (let i = 0; i < 6; i++) {
    const w = 0.25 + ((i * 37) % 7) / 10;
    quadY(ctx, 0.202, 5.88 + (i % 3) * 0.08, 5.88 + (i % 3) * 0.08 + w, 1.56 - i * 0.085, 1.59 - i * 0.085, rgba('#e8f6ff', 0.55));
  }
  // teclado + ratón
  drawBox(ctx, 5.9, 0.55, 0.82, 0.95, 0.26, 0.03, '#2c3042');
  drawBox(ctx, 7.0, 0.62, 0.82, 0.1, 0.16, 0.03, '#2c3042');
  // libreta y lápiz
  drawBox(ctx, 5.15, 0.45, 0.82, 0.42, 0.55, 0.03, '#e9dfc7');
  line(ctx, p(5.25, 0.95, 0.86), p(5.55, 0.62, 0.86), '#d6a64a', 1.3);
  // temporizador Pomodoro (tomate) cuando está corriendo
  if (env.timerRunning) {
    const c = p(5.35, 0.25, 0.9);
    dot(ctx, c, 4.5, '#e0533f');
    dot(ctx, [c[0] - 1.2, c[1] - 1.5], 1.4, rgba('#ffffff', 0.5));
    line(ctx, [c[0], c[1] - 4.5], [c[0] + 1.5, c[1] - 6.5], '#4f8f4a', 1.4);
  }
  // flexo
  const base = p(7.45, 0.3, 0.82);
  ctx.fillStyle = MAT.dark;
  ctx.beginPath();
  ctx.ellipse(base[0], base[1], 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const elbow = p(7.55, 0.22, 1.32), head = p(7.1, 0.5, 1.48);
  line(ctx, base, elbow, '#3a3e52', 2);
  line(ctx, elbow, head, '#3a3e52', 2);
  const lampOn = env.level >= 2;
  ctx.fillStyle = '#3a3e52';
  ctx.beginPath();
  ctx.moveTo(head[0] - 2, head[1] - 2);
  ctx.lineTo(head[0] + 9, head[1] + 3);
  ctx.lineTo(head[0] + 3, head[1] + 10);
  ctx.closePath();
  ctx.fill();
  if (lampOn) dot(ctx, [head[0] + 5, head[1] + 7], 2.4, '#fff4d6');

  // silla
  drawBox(ctx, 6.1, 1.55, 0.04, 0.7, 0.08, 0.04, MAT.dark);
  drawBox(ctx, 6.41, 1.3, 0.04, 0.08, 0.6, 0.04, MAT.dark);
  drawBox(ctx, 6.42, 1.56, 0.08, 0.06, 0.06, 0.38, MAT.metal);
  drawBox(ctx, 6.1, 1.3, 0.46, 0.72, 0.62, 0.08, '#3f4a73');
  drawBox(ctx, 6.1, 1.9, 0.5, 0.72, 0.08, 0.7, '#3f4a73');
}

// ---------------------------------------------------------------------------
// Cocina (Nutrición)

function drawKitchen(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const X = 7.05;
  drawBox(ctx, X, 2.3, 0, 0.9, 2.05, 0.9, MAT.counter);
  // puertas en la cara visible (x = 7.95)
  const fx = X + 0.901;
  for (let i = 0; i < 3; i++) {
    const y0 = 2.38 + i * 0.66, y1 = y0 + 0.6;
    quadX(ctx, fx, y0, y1, 0.08, 0.82, shade(MAT.counter, -0.38));
    quadX(ctx, fx + 0.001, y0 + 0.04, y1 - 0.04, 0.12, 0.78, shade(MAT.counter, -0.48));
    line(ctx, p(fx, y0 + 0.08, 0.7), p(fx, y0 + 0.08, 0.5), '#d8d8e0', 1.2);
  }
  // encimera
  drawBox(ctx, 7.0, 2.25, 0.9, 1.0, 2.15, 0.07, MAT.stone);
  // tira LED bajo la encimera (nivel 5+)
  if (env.level >= 5) quadX(ctx, 8.0, 2.27, 4.38, 0.86, 0.9, '#ffe7b0');
  // fregadero + grifo
  quadZ(ctx, 0.971, 7.25, 7.8, 2.45, 3.05, '#3a3d4e');
  quadZ(ctx, 0.972, 7.3, 7.75, 2.5, 3.0, '#2a2c3a');
  drawBox(ctx, 7.12, 2.72, 0.97, 0.06, 0.06, 0.24, '#c8ccd8');
  drawBox(ctx, 7.12, 2.72, 1.17, 0.22, 0.05, 0.04, '#c8ccd8');
  // tabla de cortar con verduras
  drawBox(ctx, 7.2, 3.3, 0.97, 0.6, 0.45, 0.03, '#d2a679');
  dot(ctx, p(7.4, 3.45, 1.03), 2.2, '#e0782f');
  dot(ctx, p(7.6, 3.6, 1.03), 2.4, '#5aa04a');
  // frutero (nivel 4+) / bolsa de patatas fritas antes
  if (env.level >= 4) {
    drawCylinder(ctx, 7.5, 4.05, 0.97, 0.18, 0.08, '#e8e2d4');
    dot(ctx, p(7.45, 4.0, 1.1), 2.6, '#f29a38');
    dot(ctx, p(7.58, 4.1, 1.1), 2.6, '#e54b3c');
    dot(ctx, p(7.5, 3.95, 1.14), 2.4, '#f2c443');
  } else {
    drawBox(ctx, 7.3, 3.95, 0.97, 0.35, 0.2, 0.22, '#d9473b');
  }
  // jarra de agua
  drawCylinder(ctx, 7.25, 3.95, 0.97, 0.07, 0.22, '#bfe6ff');

  // nevera
  const Y = 4.45;
  drawBox(ctx, 7.0, Y, 0, 1.0, 0.9, 1.75, MAT.fridge);
  quadX(ctx, 8.001, Y + 0.04, Y + 0.86, 1.18, 1.2, shade(MAT.fridge, -0.6));
  line(ctx, p(8.0, Y + 0.12, 1.05), p(8.0, Y + 0.12, 0.6), '#9aa0b4', 1.6);
  line(ctx, p(8.0, Y + 0.12, 1.55), p(8.0, Y + 0.12, 1.3), '#9aa0b4', 1.6);
  // imanes
  quadX(ctx, 8.002, Y + 0.45, Y + 0.6, 1.4, 1.52, '#ffb347');
  quadX(ctx, 8.002, Y + 0.62, Y + 0.72, 0.9, 1.05, '#7fd6ff');
  // indicador/luz de nevera (nivel 5+)
  if (env.level >= 5) quadX(ctx, 8.003, Y + 0.3, Y + 0.38, 1.62, 1.66, '#fff2c0');
}

// ---------------------------------------------------------------------------
// Esterilla y mancuernas (Cuerpo)

function dumbbell(ctx: CanvasRenderingContext2D, x: number, y: number, alongY: boolean) {
  const c = '#3c4054';
  if (alongY) {
    drawBox(ctx, x, y, 0, 0.14, 0.1, 0.14, c);
    drawBox(ctx, x + 0.05, y + 0.1, 0.05, 0.04, 0.3, 0.04, '#9aa0b4');
    drawBox(ctx, x, y + 0.4, 0, 0.14, 0.1, 0.14, c);
  } else {
    drawBox(ctx, x, y, 0, 0.1, 0.14, 0.14, c);
    drawBox(ctx, x + 0.1, y + 0.05, 0.05, 0.3, 0.04, 0.04, '#9aa0b4');
    drawBox(ctx, x + 0.4, y, 0, 0.1, 0.14, 0.14, c);
  }
}

function drawMat(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  if (env.level >= 5) {
    dumbbell(ctx, 3.45, 5.45, true);
    dumbbell(ctx, 3.45, 6.05, true);
    drawBox(ctx, 3.9, 5.3, 0, 2.1, 1.25, 0.035, MAT.mat);
    for (let i = 1; i < 5; i++) quadZ(ctx, 0.036, 3.9 + i * 0.42, 3.92 + i * 0.42, 5.32, 6.53, rgba('#ffffff', 0.18));
    // botella de agua
    drawCylinder(ctx, 5.7, 6.4, 0.035, 0.06, 0.28, '#7fd6ff');
  } else {
    // esterilla enrollada + mancuerna tirada
    drawBox(ctx, 4.2, 5.4, 0, 0.32, 1.25, 0.3, MAT.mat);
    const e = p(4.36, 6.65, 0.15);
    ctx.fillStyle = shade(MAT.mat, -0.35);
    ctx.beginPath();
    ctx.ellipse(e[0], e[1], 5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade(MAT.mat, 0.2);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(e[0], e[1], 2.6, 2.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    dumbbell(ctx, 5.2, 5.9, false);
  }
}

// ---------------------------------------------------------------------------
// Planta (Hábitos / Orden)

export function plantStage(level: number): 1 | 2 | 3 | 4 {
  if (level >= 9) return 4;
  if (level >= 7) return 3;
  if (level >= 4) return 2;
  return 1;
}

function drawPlant(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const X = 7.15, Y = 6.7, S = 0.6;
  // maceta
  drawBox(ctx, X, Y, 0, S, S, 0.42, MAT.terracotta);
  drawBox(ctx, X - 0.03, Y - 0.03, 0.42, S + 0.06, S + 0.06, 0.06, shade(MAT.terracotta, 0.1));
  quadZ(ctx, 0.481, X + 0.04, X + S - 0.04, Y + 0.04, Y + S - 0.04, '#4a3328');
  const stage = plantStage(env.level);
  const base = p(X + S / 2, Y + S / 2, 0.48);
  const sway = env.reducedMotion ? 0 : Math.sin(env.t * 0.9) * 0.04;
  const vivid = env.meters.orden > 0.3 || env.level >= 4;
  const green = vivid ? MAT.leaf : MAT.leafDull;
  const dark = vivid ? MAT.leafDark : shade(MAT.leafDull, -0.25);
  if (stage === 1) {
    line(ctx, base, [base[0], base[1] - 9], dark, 1.4);
    leaf(ctx, [base[0], base[1] - 8], 9, 3.5, -2.6 + sway, green);
    leaf(ctx, [base[0], base[1] - 9], 9, 3.5, -0.5 + sway, green);
    return;
  }
  const n = stage === 2 ? 6 : stage === 3 ? 10 : 13;
  const len = stage === 2 ? 15 : stage === 3 ? 22 : 26;
  const height = stage === 2 ? 14 : stage === 3 ? 24 : 32;
  const rnd = mulberry32(7);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 2.6 + sway * (1 + t);
    const hh = height * (0.35 + rnd() * 0.65);
    const stemTop: P2 = [base[0] + Math.cos(ang) * hh * 0.25, base[1] - hh];
    line(ctx, base, stemTop, dark, 1.1);
    leaf(ctx, stemTop, len * (0.6 + rnd() * 0.4), len * 0.28, ang + (rnd() - 0.5) * 0.6, i % 3 ? green : dark);
  }
  if (stage === 4) {
    const flowers = ['#ff9fb8', '#fff0f5', '#ffd98a'];
    const r2 = mulberry32(11);
    for (let i = 0; i < 7; i++) {
      const fx = base[0] + (r2() - 0.5) * 34;
      const fy = base[1] - height * (0.6 + r2() * 0.5);
      dot(ctx, [fx, fy], 2.3, flowers[i % 3]);
      dot(ctx, [fx, fy], 0.9, '#e0a030');
    }
  }
}

// ---------------------------------------------------------------------------
// Mesa baja + taza (Social / Finanzas)

function drawTable(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const X = 3.0, Y = 3.0, S = 1.3, H = 0.42;
  for (const [dx, dy] of [[0.06, 0.06], [S - 0.14, 0.06], [0.06, S - 0.14], [S - 0.14, S - 0.14]]) {
    drawBox(ctx, X + dx, Y + dy, 0, 0.08, 0.08, H - 0.06, MAT.woodDark);
  }
  drawBox(ctx, X + 0.1, Y + 0.1, 0.12, S - 0.2, S - 0.2, 0.03, shade(MAT.wood, -0.1));
  drawBox(ctx, X, Y, H - 0.06, S, S, 0.06, MAT.wood);
  // cuaderno de finanzas + móvil
  drawBox(ctx, X + 0.18, Y + 0.2, H, 0.45, 0.35, 0.03, '#2f5d4a');
  quadZ(ctx, H + 0.031, X + 0.22, X + 0.6, Y + 0.24, Y + 0.28, rgba('#e8d7a0', 0.8));
  drawBox(ctx, X + 0.25, Y + 0.75, H, 0.3, 0.17, 0.02, '#1e2130');
  quadZ(ctx, H + 0.021, X + 0.27, X + 0.53, Y + 0.77, Y + 0.9, env.meters.orden > 0.5 ? '#ffd98a' : '#3d5a8a');
  // taza
  drawCylinder(ctx, X + 0.9, Y + 0.55, H, 0.09, 0.16, '#e9e4f2');
  const top = p(X + 0.9, Y + 0.55, H + 0.16);
  ctx.fillStyle = '#5a3a28';
  ctx.beginPath();
  ctx.ellipse(top[0], top[1], 4.2, 2.1, 0, 0, Math.PI * 2);
  ctx.fill();
  const hdl = p(X + 0.9, Y + 0.67, H + 0.08);
  ctx.strokeStyle = '#d8d2e2';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(hdl[0] - 3, hdl[1], 2.6, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Decoración por nivel

function drawGarland(ctx: CanvasRenderingContext2D, env: SceneEnv) {
  const z = 2.78;
  const runs: [number, number, number, number][] = [
    [0.25, 0.04, 7.8, 0.04], // pared derecha (y = 0)
    [0.04, 0.25, 0.04, 7.8], // pared izquierda (x = 0)
  ];
  for (const [ax, ay, bx, by] of runs) {
    const n = 22;
    ctx.strokeStyle = 'rgba(40,40,50,0.8)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    const pts: P2[] = [];
    for (let i = 0; i <= n * 2; i++) {
      const t = i / (n * 2);
      const seg = (t * 3) % 1; // tres festones
      const sag = Math.sin(seg * Math.PI) * 0.22;
      const pt = p(ax + (bx - ax) * t, ay + (by - ay) * t, z - sag);
      pts.push(pt);
      if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]);
    }
    ctx.stroke();
    for (let i = 1; i < pts.length; i += 2) {
      const tw = env.reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(env.t * 2.2 + i * 1.3);
      dot(ctx, [pts[i][0], pts[i][1] + 1.5], 1.7, rgba(i % 4 === 1 ? '#ffd98a' : '#ffb347', tw));
    }
  }
}

function drawPainting(ctx: CanvasRenderingContext2D) {
  const x0 = 5.5, x1 = 7.4, z0 = 1.9, z1 = 2.6, y = 0.03;
  quadY(ctx, y, x0, x1, z0, z1, MAT.woodDark);
  quadY(ctx, y + 0.005, x0 + 0.06, x1 - 0.06, z0 + 0.06, z1 - 0.06, '#26355e');
  // montañas nevadas + luna
  fillPoly(ctx, [[x0 + 0.06, y + 0.01, z0 + 0.06], [x0 + 0.6, y + 0.01, z0 + 0.45], [x0 + 1.0, y + 0.01, z0 + 0.06]], '#c9d6f0');
  fillPoly(ctx, [[x0 + 0.7, y + 0.01, z0 + 0.06], [x0 + 1.3, y + 0.01, z0 + 0.38], [x1 - 0.06, y + 0.01, z0 + 0.06]], '#9fb3dc');
  dot(ctx, p(x1 - 0.35, y + 0.01, z1 - 0.2), 3, '#ffe9b0');
}

function drawClothes(ctx: CanvasRenderingContext2D) {
  const items: { x: number; y: number; c: string }[] = [
    { x: 2.3, y: 6.3, c: '#5b6a9a' },
    { x: 4.6, y: 2.0, c: '#a24a5a' },
    { x: 1.5, y: 4.3, c: '#7a7f8f' },
  ];
  for (const it of items) {
    fillPoly(ctx, [
      [it.x, it.y, 0.01], [it.x + 0.55, it.y - 0.1, 0.01], [it.x + 0.7, it.y + 0.3, 0.01],
      [it.x + 0.4, it.y + 0.55, 0.01], [it.x + 0.05, it.y + 0.4, 0.01],
    ], it.c);
    fillPoly(ctx, [[it.x + 0.15, it.y + 0.1, 0.03], [it.x + 0.45, it.y + 0.05, 0.03], [it.x + 0.4, it.y + 0.3, 0.03]], shade(it.c, 0.15));
  }
}

function drawRug(ctx: CanvasRenderingContext2D) {
  const x0 = 2.15, x1 = 5.15, y0 = 2.15, y1 = 5.05;
  quadZ(ctx, 0.005, x0, x1, y0, y1, MAT.rugBorder);
  quadZ(ctx, 0.006, x0 + 0.12, x1 - 0.12, y0 + 0.12, y1 - 0.12, MAT.rug);
  quadZ(ctx, 0.007, x0 + 0.5, x1 - 0.5, y0 + 0.5, y1 - 0.5, shade(MAT.rug, -0.15));
  fillPoly(ctx, [
    [(x0 + x1) / 2, y0 + 0.75, 0.008], [x1 - 0.75, (y0 + y1) / 2, 0.008],
    [(x0 + x1) / 2, y1 - 0.75, 0.008], [x0 + 0.75, (y0 + y1) / 2, 0.008],
  ], MAT.rugBorder);
}

// ---------------------------------------------------------------------------
// Catálogo

export const SCENE_OBJECTS: SceneObject[] = [
  // Pared
  { id: 'window', target: 'window', label: 'Ventana', layer: 'wall', box: { x: WINDOW.x0 - 0.15, y: -WALL_T, z: WINDOW.z0 - 0.1, w: WINDOW.x1 - WINDOW.x0 + 0.3, d: WALL_T + 0.22, h: WINDOW.z1 - WINDOW.z0 + 0.15 }, draw: drawWindow },
  { id: 'corkboard', target: 'corkboard', label: 'Corcho de metas', layer: 'wall', box: { x: 0, y: CORK.y0, z: CORK.z0, w: 0.1, d: CORK.y1 - CORK.y0, h: CORK.z1 - CORK.z0 }, draw: drawCorkboard },
  { id: 'painting', layer: 'wall', box: { x: 5.5, y: 0, z: 1.9, w: 1.9, d: 0.05, h: 0.7 }, visible: (e) => e.level >= 7, draw: drawPainting },
  { id: 'garland', layer: 'wall', box: { x: 0, y: 0, z: 2.5, w: 8, d: 8, h: 0.3 }, visible: (e) => e.level >= 6, draw: drawGarland },
  // Suelo
  { id: 'rug', layer: 'floor', box: { x: 2.15, y: 2.15, z: 0, w: 3, d: 2.9, h: 0 }, visible: (e) => e.level >= 6, draw: drawRug },
  { id: 'clothes', layer: 'floor', box: { x: 1.5, y: 2, z: 0, w: 4, d: 5, h: 0 }, visible: (e) => e.level < 3, draw: drawClothes },
  // Objetos
  { id: 'shelf', target: 'shelf', label: 'Estantería', layer: 'object', box: { x: 0, y: 0.9, z: 0, w: 0.85, d: 2.1, h: 2.4 }, draw: drawShelf },
  { id: 'bed', target: 'bed', label: 'Cama', layer: 'object', box: { x: 0, y: 4.95, z: 0, w: 2.72, d: 2.65, h: 1.05 }, draw: drawBed },
  { id: 'desk', target: 'desk', label: 'Escritorio', layer: 'object', box: { x: 5.0, y: 0, z: 0, w: 2.9, d: 2.0, h: 1.72 }, draw: drawDesk },
  { id: 'kitchen', target: 'kitchen', label: 'Cocina', layer: 'object', box: { x: 7.0, y: 2.25, z: 0, w: 1.0, d: 3.1, h: 1.75 }, draw: drawKitchen },
  { id: 'mat', target: 'mat', label: 'Esterilla', layer: 'object', box: { x: 3.4, y: 5.3, z: 0, w: 2.7, d: 1.45, h: 0.4 }, draw: drawMat },
  { id: 'plant', target: 'plant', label: 'Planta', layer: 'object', box: { x: 7.1, y: 6.65, z: 0, w: 0.7, d: 0.7, h: 1.4 }, draw: drawPlant },
  { id: 'table', target: 'table', label: 'Mesa baja', layer: 'object', box: { x: 3.0, y: 3.0, z: 0, w: 1.3, d: 1.3, h: 0.7 }, draw: drawTable },
  // Desorden (nivel 1)
  {
    id: 'boxes', layer: 'object', box: { x: 1.3, y: 1.15, z: 0, w: 0.75, d: 0.65, h: 0.85 }, visible: (e) => e.level < 2,
    draw: (ctx) => {
      drawBox(ctx, 1.3, 1.15, 0, 0.75, 0.65, 0.5, MAT.cardboard);
      quadZ(ctx, 0.501, 1.3, 2.05, 1.45, 1.5, rgba('#d9c08a', 0.9));
      drawBox(ctx, 1.4, 1.2, 0.5, 0.55, 0.5, 0.35, shade(MAT.cardboard, 0.08));
      quadZ(ctx, 0.851, 1.4, 1.95, 1.42, 1.47, rgba('#d9c08a', 0.9));
    },
  },
  {
    id: 'box2', layer: 'object', box: { x: 5.35, y: 3.3, z: 0, w: 0.6, d: 0.6, h: 0.45 }, visible: (e) => e.level < 2,
    draw: (ctx) => {
      drawBox(ctx, 5.35, 3.3, 0, 0.6, 0.6, 0.45, shade(MAT.cardboard, -0.05));
      fillPoly(ctx, [[5.35, 3.3, 0.45], [5.95, 3.3, 0.45], [5.85, 3.1, 0.62], [5.3, 3.12, 0.6]], shade(MAT.cardboard, 0.12));
    },
  },
];

/** Devuelve los objetos visibles en orden de dibujo (pared → suelo → objetos por profundidad). */
export function orderedObjects(env: SceneEnv): SceneObject[] {
  const vis = SCENE_OBJECTS.filter((o) => !o.visible || o.visible(env));
  const wall = vis.filter((o) => o.layer === 'wall');
  const floor = vis.filter((o) => o.layer === 'floor');
  const objs = vis.filter((o) => o.layer === 'object').sort((a, b) => depthKey(a.box) - depthKey(b.box));
  return [...wall, ...floor, ...objs];
}

/** Puntos de anclaje (en coordenadas de mundo) para luces y partículas por objeto clicable. */
export const ANCHORS: Record<ObjectId, [number, number, number]> = {
  bed: [1.4, 6.6, 0.8],
  desk: [6.4, 0.6, 1.2],
  mat: [4.8, 5.9, 0.3],
  shelf: [0.5, 2.0, 1.6],
  kitchen: [7.5, 3.6, 1.2],
  window: [3.1, 0.1, 1.8],
  plant: [7.45, 7.0, 1.0],
  corkboard: [0.1, 4.15, 1.7],
  table: [3.65, 3.65, 0.6],
};
