// Niveles de habitación (1–10) por XP y medidores de luz por pilar/objeto.
import { addDays } from './calendar';
import { activeQuests, questProgress, questRatio } from './quests';
import { OBJECTS, PILLARS, questObject, type GameState, type Intensity, type ObjectId, type PillarId, type Quest } from './state';

export const MAX_LEVEL = 10;

/**
 * Umbrales de XP acumulado para cada nivel (intensidad Normal). Curva suave: los primeros niveles
 * llegan en días; con ~75 % de lo planeado durante 88 días se alcanza el nivel 9–10.
 */
export const BASE_THRESHOLDS = [0, 160, 550, 1200, 2200, 3500, 5300, 7500, 10200, 13800];

/** Escala por intensidad: lo "planeado" cambia con la carga elegida. */
export const INTENSITY_FACTOR: Record<Intensity, number> = { suave: 0.65, normal: 1, intensa: 1.2 };

export function thresholds(intensity: Intensity): number[] {
  const k = INTENSITY_FACTOR[intensity];
  return BASE_THRESHOLDS.map((t) => Math.round((t * k) / 10) * 10);
}

export function levelFor(xp: number, intensity: Intensity): number {
  const th = thresholds(intensity);
  let lvl = 1;
  for (let i = 0; i < th.length; i++) if (xp >= th[i]) lvl = i + 1;
  return Math.min(MAX_LEVEL, lvl);
}

export interface LevelProgress { level: number; xp: number; from: number; to: number | null; pct: number }

export function levelProgress(xp: number, intensity: Intensity): LevelProgress {
  const th = thresholds(intensity);
  const level = levelFor(xp, intensity);
  const from = th[level - 1];
  const to = level < MAX_LEVEL ? th[level] : null;
  const pct = to === null ? 1 : Math.max(0, Math.min(1, (xp - from) / (to - from)));
  return { level, xp, from, to, pct };
}

// ---------------------------------------------------------------------------
// Medidores de luz (0..1): max(hoy, media de los últimos 7 días)

function dayScore(state: GameState, filter: (q: Quest) => boolean, date: string): number | null {
  const qs = activeQuests(state, date).filter((q) => q.kind !== 'milestone' && filter(q));
  if (!qs.length) return null;
  let sum = 0;
  for (const q of qs) sum += questRatio(q, questProgress(state, q, date));
  return sum / qs.length;
}

function meter(state: GameState, filter: (q: Quest) => boolean, today: string): number {
  const todayScore = dayScore(state, filter, today) ?? 0;
  let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    if (d < state.meta.createdAt) break;
    const s = dayScore(state, filter, d);
    if (s === null) continue;
    sum += s;
    n++;
  }
  return Math.max(todayScore, n ? sum / n : 0);
}

export function pillarMeter(state: GameState, pillar: PillarId, today: string): number {
  return meter(state, (q) => q.pillar === pillar, today);
}

export function objectMeter(state: GameState, obj: ObjectId, today: string): number {
  const m = meter(state, (q) => questObject(q) === obj, today);
  if (obj === 'corkboard' && state.goals.length) {
    return Math.max(m, state.goals.filter((g) => g.done).length / state.goals.length);
  }
  return m;
}

export function allPillarMeters(state: GameState, today: string): Record<PillarId, number> {
  return Object.fromEntries(PILLARS.map((p) => [p, pillarMeter(state, p, today)])) as Record<PillarId, number>;
}

export function allObjectMeters(state: GameState, today: string): Record<ObjectId, number> {
  return Object.fromEntries(OBJECTS.map((o) => [o, objectMeter(state, o, today)])) as Record<ObjectId, number>;
}

/** Lo que desbloquea cada nivel (para mensajes y la consola de depuración). */
export const LEVEL_UNLOCKS: Record<number, string> = {
  1: 'Habitación a oscuras y desordenada, una sola luz tenue',
  2: 'Fuera cajas; se enciende el flexo del escritorio',
  3: 'Cama hecha y primeras luces cálidas en la ventana',
  4: 'La estantería gana libros; la planta crece',
  5: 'Esterilla y mancuernas en su sitio; luz en la cocina',
  6: 'Guirnalda de luces en las paredes y alfombra',
  7: 'Corcho lleno de metas, un cuadro y la planta sigue creciendo',
  8: 'Taza humeante y luz cálida junto a la cama',
  9: 'La planta florece, más libros y cortinas',
  10: 'Habitación completa: nieve dorada y la ciudad más brillante',
};
