// Calendario del arco: fechas lógicas (reseteo a las 04:00), fases y día N de M.
// Las fechas se manejan como cadenas 'YYYY-MM-DD' (hora local) y se operan en días UTC,
// así los cálculos no dependen de cambios de horario.

export const RESET_HOUR = 4;
export const DEFAULT_START = '2026-10-05';
export const DEFAULT_END = '2026-12-31';

const DAY_MS = 86_400_000;

export type Phase = 1 | 2 | 3;

export const PHASES: Record<Phase, { name: string; focus: string }> = {
  1: { name: 'Cimientos', focus: 'Instalar hábitos mínimos' },
  2: { name: 'Construcción', focus: 'Subir la carga; aparecen retos semanales' },
  3: { name: 'Remate', focus: 'Consolidar, revisión final, cerrar metas' },
};

const pad = (n: number) => String(n).padStart(2, '0');

export function fmt(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function toDayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): string {
  const dt = new Date(n * DAY_MS);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: string, n: number): string {
  return fromDayNumber(toDayNumber(date) + n);
}

/** b − a en días. */
export function diffDays(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** 0 = lunes … 6 = domingo. */
export function weekday(date: string): number {
  // 1970-01-01 fue jueves (3 si lunes = 0)
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return fromDayNumber(toDayNumber(s)) === fmt(y, m, d);
}

/**
 * Día lógico: antes de las 04:00 locales todavía cuenta como el día anterior
 * (evita que "hoy" se corte a medianoche si el jugador trasnocha).
 */
export function logicalDate(now: Date): string {
  const today = fmt(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return now.getHours() < RESET_HOUR ? addDays(today, -1) : today;
}

/** Lunes de la semana del día lógico (las semanales se resetean el lunes a las 04:00). */
export function weekStart(date: string): string {
  return addDays(date, -weekday(date));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function arcLength(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

/** Fin del arco: siempre el 31/12 del año de inicio. */
export function arcEndFor(start: string): string {
  return `${start.slice(0, 4)}-12-31`;
}

/** Duración de cada fase: proporcional al reparto por defecto 28/35/25 de 88 días. */
export function phaseLengths(total: number): [number, number, number] {
  if (total <= 3) return [1, Math.max(0, total - 2), Math.min(1, Math.max(0, total - 1))] as [number, number, number];
  const p1 = Math.max(1, Math.round((total * 28) / 88));
  const p2 = Math.max(1, Math.round((total * 35) / 88));
  return [p1, p2, Math.max(1, total - p1 - p2)];
}

export interface ArcInfo {
  status: 'pre' | 'active' | 'post';
  /** Día N (1..total) del arco; 0 antes de empezar. */
  day: number;
  total: number;
  phase: Phase;
  phaseName: string;
  daysUntilStart: number;
  daysLeft: number;
  /** Día en que empieza cada fase. */
  phaseStarts: [string, string, string];
}

export function arcInfo(arc: { start: string; end: string }, date: string): ArcInfo {
  const total = arcLength(arc.start, arc.end);
  const [p1, p2] = phaseLengths(total);
  const phaseStarts: [string, string, string] = [arc.start, addDays(arc.start, p1), addDays(arc.start, p1 + p2)];
  const idx = diffDays(arc.start, date); // 0-based
  let status: ArcInfo['status'] = 'active';
  if (idx < 0) status = 'pre';
  else if (idx >= total) status = 'post';
  const day = status === 'pre' ? 0 : status === 'post' ? total : idx + 1;
  const phase: Phase = status === 'pre' ? 1 : idx < p1 ? 1 : idx < p1 + p2 ? 2 : 3;
  return {
    status,
    day,
    total,
    phase,
    phaseName: PHASES[phase].name,
    daysUntilStart: Math.max(0, -idx),
    daysLeft: Math.max(0, total - Math.max(0, idx)),
    phaseStarts,
  };
}

export function phaseOn(arc: { start: string; end: string }, date: string): Phase {
  return arcInfo(arc, date).phase;
}

/** Índice de semana del arco (0 = semana del día de inicio). */
export function arcWeekIndex(arcStart: string, date: string): number {
  return Math.floor(diffDays(weekStart(arcStart), weekStart(date)) / 7);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function prettyDate(date: string, withWeekday = false): string {
  const [, m, d] = date.split('-').map(Number);
  const s = `${d} ${MONTHS[m - 1]}`;
  return withWeekday ? `${DAYS[weekday(date)]} ${s}` : s;
}
