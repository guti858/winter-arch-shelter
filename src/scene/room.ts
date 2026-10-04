// Definición del cuarto: suelo, losa del diorama y paredes (con hueco de ventana).
import { fillPoly, p, pathPoly, type P2, type P3 } from '../engine/iso';
import { rgba, shade } from '../engine/color';
import { MAT } from './palette';

export const ROOM_SIZE = 8;
export const WALL_H = 3;
export const WALL_T = 0.22;
export const SLAB = 0.45;

/** Hueco de la ventana en la pared derecha (plano y = 0). */
export const WINDOW = { x0: 1.7, x1: 4.5, z0: 0.95, z1: 2.6 };

/** Silueta exterior del diorama (para clips de luz). */
export function roomSilhouette(): P2[] {
  const T = WALL_T, S = ROOM_SIZE;
  return [
    p(-T, -T, WALL_H),
    p(S, -T, WALL_H),
    p(S, -T, -SLAB),
    p(S, S, -SLAB),
    p(-T, S, -SLAB),
    p(-T, S, WALL_H),
  ];
}

export function pathSilhouette(ctx: CanvasRenderingContext2D) {
  const pts = roomSilhouette();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Polígono del hueco de la ventana (en el plano interior de la pared). */
export function windowHole(): P3[] {
  const { x0, x1, z0, z1 } = WINDOW;
  return [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
}

export function drawShadow(ctx: CanvasRenderingContext2D) {
  const [cx, cy] = p(ROOM_SIZE / 2, ROOM_SIZE / 2, -SLAB - 1.6);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.42);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 330);
  g.addColorStop(0, 'rgba(2,3,12,0.55)');
  g.addColorStop(0.55, 'rgba(2,3,12,0.25)');
  g.addColorStop(1, 'rgba(2,3,12,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawFloor(ctx: CanvasRenderingContext2D) {
  const S = ROOM_SIZE;
  // Losa: caras frontales
  fillPoly(ctx, [[-WALL_T, S, -SLAB], [S, S, -SLAB], [S, S, 0], [-WALL_T, S, 0]], MAT.slabLeft);
  fillPoly(ctx, [[S, -WALL_T, -SLAB], [S, S, -SLAB], [S, S, 0], [S, -WALL_T, 0]], MAT.slabRight);
  // Borde inferior iluminado por la ciudad
  ctx.strokeStyle = 'rgba(255,190,140,0.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const a = p(-WALL_T, S, -SLAB), b = p(S, S, -SLAB), c = p(S, -WALL_T, -SLAB);
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
  ctx.stroke();

  // Tarimas a lo largo de x
  const plank = 0.5;
  for (let j = 0, i = 0; j < S; j += plank, i++) {
    fillPoly(ctx, [[0, j, 0], [S, j, 0], [S, j + plank, 0], [0, j + plank, 0]], i % 2 ? MAT.floorA : MAT.floorB);
  }
  ctx.strokeStyle = rgba(MAT.floorLine, 0.55);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let j = plank, i = 0; j < S; j += plank, i++) {
    const s = p(0, j), e = p(S, j);
    ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]);
    // juntas escalonadas
    for (let k = (i % 3) * 1.3 + 0.9; k < S; k += 3.1) {
      const u = p(k, j - plank), v = p(k, j);
      ctx.moveTo(u[0], u[1]); ctx.lineTo(v[0], v[1]);
    }
  }
  ctx.stroke();
  // Borde superior de la losa
  ctx.strokeStyle = rgba(shade(MAT.floorA, 0.25), 0.6);
  ctx.beginPath();
  const d = p(0, S), e = p(S, S), f = p(S, 0);
  ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(f[0], f[1]);
  ctx.stroke();
}

function vGradient(ctx: CanvasRenderingContext2D, zLow: P2, zHigh: P2, cLow: string, cHigh: string) {
  const g = ctx.createLinearGradient(zLow[0], zLow[1], zHigh[0], zHigh[1]);
  g.addColorStop(0, cLow);
  g.addColorStop(1, cHigh);
  return g;
}

export function drawWalls(ctx: CanvasRenderingContext2D) {
  const S = ROOM_SIZE, H = WALL_H, T = WALL_T;

  // --- Pared izquierda (plano x = 0), cara interior
  pathPoly(ctx, [[0, 0, 0], [0, S, 0], [0, S, H], [0, 0, H]]);
  ctx.fillStyle = vGradient(ctx, p(0, 4, 0), p(0, 4, H), shade(MAT.wallLeft, -0.12), MAT.wallLeft);
  ctx.fill();
  // Zócalo
  fillPoly(ctx, [[0.02, 0, 0], [0.02, S, 0], [0.02, S, 0.14], [0.02, 0, 0.14]], MAT.baseboard);

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
  fillPoly(ctx, [[0, 0.02, 0], [S, 0.02, 0], [S, 0.02, 0.14], [0, 0.02, 0.14]], shade(MAT.baseboard, 0.08));

  // Esquina interior: línea de sombra
  ctx.strokeStyle = 'rgba(10,12,30,0.35)';
  ctx.lineWidth = 1.5;
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
}
