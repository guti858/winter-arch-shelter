// El edificio bajo la habitación: tu historial del arco.
// Una planta por semana (la 1, "Cimientos", junto a la calle; la última, "Remate", justo bajo la
// habitación) y una ventana por día en cada fachada: cálida si cumpliste el mínimo, azul si fue
// descanso, apagada si no. Las semanas futuras están a oscuras: el arco se construye hacia arriba.
import { boxHull, drawBox, fillPoly, p, type P2 } from '../engine/iso';
import { rgba, shade } from '../engine/color';
import type { DayLight } from '../game/streaks';
import type { TowerInfo } from './objects';
import { ROOM_SIZE, SLAB, WALL_T } from './room';

export const FLOOR_H = 0.42; // altura de cada planta (semana)
export const LOBBY_H = 1.15; // planta baja
export const DEFAULT_WEEKS = 13;

const T = WALL_T, S = ROOM_SIZE;

/** Cota de la calle según el número de semanas del arco. */
export function streetZ(weeks: number): number {
  return -SLAB - LOBBY_H - Math.max(1, weeks) * FLOOR_H;
}

export function floorRange(weeks: number, k: number): [number, number] {
  const zb = streetZ(weeks) + LOBBY_H + k * FLOOR_H;
  return [zb, zb + FLOOR_H];
}

/** Envolvente de cada planta (para el hover/clic sobre el historial). */
export function floorHulls(weeks: number): P2[][] {
  return Array.from({ length: weeks }, (_, k) => {
    const [z0, z1] = floorRange(weeks, k);
    return boxHull({ x: -T, y: -T, z: z0, w: S + T, d: S + T, h: z1 - z0 });
  });
}

const FACADE: Record<1 | 2 | 3, string> = {
  1: '#3a3552', // Cimientos: piedra
  2: '#463448', // Construcción: ladrillo
  3: '#33405e', // Remate: azul pizarra
};

const WIN: Record<DayLight, { glass: string; glow?: string; a?: number }> = {
  none: { glass: '' },
  future: { glass: '#161830' },
  off: { glass: '#1d1f38' },
  today: { glass: '#2a2a44' },
  rest: { glass: '#7cc6ec', glow: '#7fd6ff', a: 0.22 },
  lit: { glass: '#f2c071', glow: '#ffb347', a: 0.22 },
  bright: { glass: '#ffe2a0', glow: '#ffc46b', a: 0.38 },
};

/** Ventanas de una planta en las dos fachadas visibles: fachada izquierda (y = S) y derecha (x = S). */
function windowQuads(k: number, weeks: number, i: number) {
  const [zb] = floorRange(weeks, k);
  const z0 = zb + 0.1, z1 = zb + 0.3;
  const u0 = -T + 0.52 + i * 1.18, u1 = u0 + 0.46;
  return {
    left: [[u0, S + 0.005, z0], [u1, S + 0.005, z0], [u1, S + 0.005, z1], [u0, S + 0.005, z1]] as [number, number, number][],
    right: [[S + 0.005, u0, z0], [S + 0.005, u1, z0], [S + 0.005, u1, z1], [S + 0.005, u0, z1]] as [number, number, number][],
  };
}

export function drawTower(ctx: CanvasRenderingContext2D, info: TowerInfo) {
  const weeks = Math.max(1, info.weeks.length || DEFAULT_WEEKS);
  const z0 = streetZ(weeks);
  const top = -SLAB;

  // Fachadas por fase
  for (let k = 0; k < weeks; k++) {
    const w = info.weeks[k];
    const [a, b] = floorRange(weeks, k);
    const base = FACADE[w?.phase ?? 1];
    fillPoly(ctx, [[-T, S, a], [S, S, a], [S, S, b], [-T, S, b]], base);
    fillPoly(ctx, [[S, -T, a], [S, S, a], [S, S, b], [S, -T, b]], shade(base, -0.3));
    // forjado entre plantas
    fillPoly(ctx, [[-T, S, b - 0.025], [S, S, b - 0.025], [S, S, b], [-T, S, b]], shade(base, -0.25));
    fillPoly(ctx, [[S, -T, b - 0.025], [S, S, b - 0.025], [S, S, b], [S, -T, b]], shade(base, -0.45));
    // cornisa al cambiar de fase
    const next = info.weeks[k + 1];
    if (w && next && next.phase !== w.phase) {
      drawBox(ctx, -T - 0.06, S - 0.02, b - 0.05, S + T + 0.12, 0.1, 0.07, '#5a5a7a');
      drawBox(ctx, S - 0.02, -T - 0.06, b - 0.05, 0.1, S + T + 0.08, 0.07, '#5a5a7a');
    }
  }

  // Ventanas: una por día (lunes → domingo)
  for (let k = 0; k < weeks; k++) {
    const w = info.weeks[k];
    for (let i = 0; i < 7; i++) {
      const light: DayLight = w ? w.lights[i] : 'future';
      const style = WIN[light];
      if (!style.glass) continue;
      const q = windowQuads(k, weeks, i);
      for (const [face, poly] of [['l', q.left], ['r', q.right]] as const) {
        if (style.glow) {
          // halo de la ventana sobre la fachada
          const c = p((poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2, (poly[0][2] + poly[2][2]) / 2);
          const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 13);
          g.addColorStop(0, rgba(style.glow, style.a ?? 0.3));
          g.addColorStop(1, rgba(style.glow, 0));
          ctx.fillStyle = g;
          ctx.fillRect(c[0] - 13, c[1] - 13, 26, 26);
        }
        fillPoly(ctx, poly, face === 'r' && !style.glow ? shade(style.glass, -0.2) : style.glass);
        if (light === 'off' || light === 'future') {
          // cortina / reflejo tenue
          const [a0, , , a3] = poly;
          fillPoly(ctx, [a0, [a0[0] + (face === 'l' ? 0.18 : 0), a0[1] + (face === 'r' ? 0.18 : 0), a0[2]], [a3[0] + (face === 'l' ? 0.18 : 0), a3[1] + (face === 'r' ? 0.18 : 0), a3[2]], a3], rgba('#7a84b8', 0.12));
        }
      }
    }
  }

  // Planta baja: portal iluminado, escaparate y rótulo
  const lb = z0, lt = z0 + LOBBY_H;
  fillPoly(ctx, [[-T, S, lb], [S, S, lb], [S, S, lt], [-T, S, lt]], '#2b2840');
  fillPoly(ctx, [[S, -T, lb], [S, S, lb], [S, S, lt], [S, -T, lt]], '#1f1d30');
  drawBox(ctx, -T - 0.05, S - 0.05, lt - 0.08, S + T + 0.1, 0.12, 0.1, '#4b4866');
  drawBox(ctx, S - 0.05, -T - 0.05, lt - 0.08, 0.12, S + T + 0.05, 0.1, '#4b4866');
  // portal (fachada izquierda)
  const door = [[3.2, S + 0.01, lb], [4.8, S + 0.01, lb], [4.8, S + 0.01, lb + 0.8], [3.2, S + 0.01, lb + 0.8]] as [number, number, number][];
  const dc = p(4, S, lb + 0.4);
  const dg = ctx.createRadialGradient(dc[0], dc[1], 0, dc[0], dc[1], 46);
  dg.addColorStop(0, 'rgba(255,200,120,0.55)');
  dg.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = dg;
  ctx.fillRect(dc[0] - 46, dc[1] - 46, 92, 92);
  fillPoly(ctx, door, '#ffcf87');
  fillPoly(ctx, [[3.98, S + 0.012, lb], [4.02, S + 0.012, lb], [4.02, S + 0.012, lb + 0.8], [3.98, S + 0.012, lb + 0.8]], '#7a5a3a');
  // escaparate (fachada derecha)
  fillPoly(ctx, [[S + 0.01, 1.0, lb + 0.15], [S + 0.01, 6.6, lb + 0.15], [S + 0.01, 6.6, lb + 0.75], [S + 0.01, 1.0, lb + 0.75]], '#c98a4a');
  fillPoly(ctx, [[S + 0.012, 1.1, lb + 0.2], [S + 0.012, 6.5, lb + 0.2], [S + 0.012, 6.5, lb + 0.7], [S + 0.012, 1.1, lb + 0.7]], '#ffbe6e');
  // rótulo de neón sobre el portal
  fillPoly(ctx, [[3.0, S + 0.02, lb + 0.88], [5.0, S + 0.02, lb + 0.88], [5.0, S + 0.02, lb + 1.04], [3.0, S + 0.02, lb + 1.04]], '#7fd6ff');

  // Cornisa superior nevada, bajo la losa de la habitación
  drawBox(ctx, -T - 0.1, S - 0.04, top - 0.14, S + T + 0.18, 0.14, 0.14, '#55597a');
  drawBox(ctx, S - 0.04, -T - 0.1, top - 0.14, 0.14, S + T + 0.1, 0.14, '#4a4e6e');
  fillPoly(ctx, [[-T - 0.1, S + 0.1, top], [S + 0.1, S + 0.1, top], [S + 0.1, S - 0.04, top], [-T - 0.1, S - 0.04, top]], '#dfe8ff');
  fillPoly(ctx, [[S - 0.04, -T - 0.1, top], [S + 0.1, -T - 0.1, top], [S + 0.1, S + 0.1, top], [S - 0.04, S + 0.1, top]], '#cfd9f5');
}

/** Pulso suave de la ventana de hoy mientras el mínimo está pendiente (dinámico, cada frame). */
export function drawTowerToday(ctx: CanvasRenderingContext2D, info: TowerInfo, t: number) {
  const weeks = info.weeks.length;
  const k = info.weeks.findIndex((w) => w.current);
  if (k < 0) return;
  const i = info.weeks[k].lights.indexOf('today');
  if (i < 0) return;
  const q = windowQuads(k, weeks, i);
  const a = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.4));
  fillPoly(ctx, q.left, rgba('#ffb347', a));
  fillPoly(ctx, q.right, rgba('#ffb347', a * 0.8));
}

/** Resalta la planta bajo el ratón. */
export function drawFloorHighlight(ctx: CanvasRenderingContext2D, weeks: number, k: number) {
  const [a, b] = floorRange(weeks, k);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,217,138,0.85)';
  ctx.lineWidth = 1.4;
  ctx.shadowColor = 'rgba(255,200,120,0.9)';
  ctx.shadowBlur = 8;
  for (const z of [a, b]) {
    const l0 = p(-T, S, z), c = p(S, S, z), r0 = p(S, -T, z);
    ctx.beginPath();
    ctx.moveTo(l0[0], l0[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(r0[0], r0[1]);
    ctx.stroke();
  }
  ctx.restore();
}
