// Rachas, tokens de descanso, "día malo" (modo reducido), reentrada y resumen semanal.
import { addDays, arcInfo, diffDays, weekDays, weekStart, weekday } from './calendar';
import { activeQuests, goalStepCount, isQuestDone, questGoal, questProgress, recomputeDay, type GameEvent } from './quests';
import { MAX_TOKENS, PILLARS, dayLog, peekDay, questTitle, type GameState, type PillarId, type Quest } from './state';

export const TOKEN_WEEK_THRESHOLD = 5; // días válidos en una semana para ganar un token
export const REENTRY_DAYS = 3;

/** Día que cuenta para la racha: mínimo cumplido, descanso planeado o token gastado. */
export function isValidDay(state: GameState, date: string): boolean {
  const d = peekDay(state, date);
  return !!d && (d.minimumMet || !!d.restDay || !!d.tokenUsed);
}

function firstRelevantDay(state: GameState): string {
  const keys = Object.keys(state.log).sort();
  const first = keys[0] ?? state.meta.createdAt;
  return first < state.meta.createdAt ? first : state.meta.createdAt;
}

/** Días consecutivos válidos hasta hoy (hoy cuenta solo si ya es válido). */
export function computeStreak(state: GameState, today: string): number {
  const floor = firstRelevantDay(state);
  let n = isValidDay(state, today) ? 1 : 0;
  for (let d = addDays(today, -1); d >= floor; d = addDays(d, -1)) {
    if (!isValidDay(state, d)) break;
    n++;
  }
  return n;
}

/** Mejor racha histórica. */
export function bestStreak(state: GameState, today: string): number {
  let best = 0, cur = 0;
  for (let d = firstRelevantDay(state); d <= today; d = addDays(d, 1)) {
    cur = isValidDay(state, d) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** Días válidos "reales" (mínimo cumplido) de una semana. */
export function validDaysInWeek(state: GameState, ws: string, upTo?: string): number {
  return weekDays(ws).filter((d) => (!upTo || d <= upTo) && peekDay(state, d)?.minimumMet).length;
}

export interface SettleResult {
  tokensEarned: number;
  tokensUsedOn: string[];
}

/**
 * Procesa los días cerrados (hasta ayer) desde el último procesado:
 * - si un día no fue válido, la racha venía viva y hay tokens → se gasta uno y el día se salva;
 * - al cerrar cada semana (domingo) con ≥5 días válidos → +1 token (máx. 2).
 * Sin tokens, la racha vuelve a 0 pero nunca se resta XP ni nivel.
 */
export function settle(state: GameState, today: string): SettleResult {
  const res: SettleResult = { tokensEarned: 0, tokensUsedOn: [] };
  ensureTokenWeeks(state);
  const yesterday = addDays(today, -1);
  let from = state.arc.start > state.meta.createdAt ? state.arc.start : state.meta.createdAt;
  if (state.meta.lastSettled && addDays(state.meta.lastSettled, 1) > from) from = addDays(state.meta.lastSettled, 1);
  const to = yesterday < state.arc.end ? yesterday : state.arc.end;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isValidDay(state, d) && state.restTokens > 0 && isValidDay(state, addDays(d, -1))) {
      dayLog(state, d).tokenUsed = true;
      state.restTokens--;
      res.tokensUsedOn.push(d);
    }
    if (weekday(d) === 6 && awardWeekToken(state, weekStart(d))) res.tokensEarned++;
  }
  if (!state.meta.lastSettled || yesterday > state.meta.lastSettled) state.meta.lastSettled = yesterday;
  return res;
}

/** Partidas antiguas: las semanas ya procesadas cuentan como evaluadas. */
function ensureTokenWeeks(state: GameState) {
  if (state.meta.tokenWeeks) return;
  const weeks: string[] = [];
  const last = state.meta.lastSettled;
  if (last) for (let ws = weekStart(state.meta.createdAt); addDays(ws, 6) <= last; ws = addDays(ws, 7)) weeks.push(ws);
  state.meta.tokenWeeks = weeks;
}

/** Evalúa una semana cerrada una sola vez: con ≥5 días válidos, +1 token (máx. 2). */
function awardWeekToken(state: GameState, ws: string): boolean {
  const done = state.meta.tokenWeeks!;
  if (done.includes(ws) || validDaysInWeek(state, ws) < TOKEN_WEEK_THRESHOLD) return false;
  done.push(ws);
  if (done.length > 30) done.splice(0, done.length - 30);
  if (state.restTokens >= MAX_TOKENS) return false;
  state.restTokens++;
  return true;
}

/**
 * Tras completar algo de ayer (periodo de gracia): si ayer cerraba una semana que ahora llega
 * a 5 días válidos, el token se concede igualmente.
 */
export function recheckWeekToken(state: GameState, today: string): boolean {
  ensureTokenWeeks(state);
  const prev = addDays(weekStart(today), -7);
  if (state.meta.lastSettled && addDays(prev, 6) <= state.meta.lastSettled) return awardWeekToken(state, prev);
  return false;
}

/** Solo se puede editar hoy y ayer (periodo de gracia de un día). */
export function canEditDate(state: GameState, date: string, today: string): boolean {
  return date === today || (date === addDays(today, -1) && date >= state.meta.createdAt);
}

/** Días seguidos sin cumplir hasta ayer (para el mensaje de reentrada). */
export function missedRun(state: GameState, today: string): number {
  const floor = state.arc.start > state.meta.createdAt ? state.arc.start : state.meta.createdAt;
  let n = 0;
  for (let d = addDays(today, -1); d >= floor; d = addDays(d, -1)) {
    if (isValidDay(state, d)) break;
    n++;
  }
  return n;
}

export function shouldShowReentry(state: GameState, today: string): boolean {
  return state.meta.reentryShown !== today && missedRun(state, today) >= REENTRY_DAYS;
}

// ---------------------------------------------------------------------------
// Día malo y descanso

/** ¿Se puede activar el modo reducido hoy? (máximo 1 vez por semana). */
export function canUseReduced(state: GameState, date: string): boolean {
  return !weekDays(weekStart(date)).some((d) => d !== date && peekDay(state, d)?.reducedMode);
}

export function setReducedMode(state: GameState, date: string, on: boolean): GameEvent[] {
  if (on && !canUseReduced(state, date)) return [];
  dayLog(state, date).reducedMode = on;
  return recomputeDay(state, date);
}

/** Gastar un token para planear un descanso hoy. */
export function useRestToken(state: GameState, date: string): boolean {
  const d = dayLog(state, date);
  if (state.restTokens <= 0 || d.restDay || d.minimumMet) return false;
  d.restDay = true;
  state.restTokens--;
  return true;
}

// ---------------------------------------------------------------------------
// Resumen semanal

export interface Adjustment {
  kind: 'lower' | 'raise';
  questId: string;
  question: string;
  change: Partial<Pick<Quest, 'target' | 'active'>>;
}

export interface WeekSummary {
  start: string;
  end: string;
  daysElapsed: number;
  validDays: number;
  xp: number;
  best?: { title: string; rate: number };
  worst?: { title: string; rate: number };
  adjustment?: Adjustment;
}

export function weekSummary(state: GameState, ws: string, today: string): WeekSummary {
  const days = weekDays(ws).filter((d) => d <= today && d >= state.meta.createdAt);
  const validDays = days.filter((d) => isValidDay(state, d)).length;
  const xp = days.reduce((s, d) => s + Math.max(0, peekDay(state, d)?.xp ?? 0), 0);
  const last = days[days.length - 1] ?? today;

  // tasa de cumplimiento por tarea
  const rates: { q: Quest; rate: number }[] = [];
  for (const q of state.quests) {
    if (q.kind === 'milestone') continue;
    if (q.kind === 'daily') {
      const applicable = days.filter((d) => activeQuests(state, d).includes(q));
      if (!applicable.length) continue;
      const done = applicable.filter((d) => isQuestDone(state, q, d)).length;
      rates.push({ q, rate: done / applicable.length });
    } else if (activeQuests(state, last).includes(q)) {
      rates.push({ q, rate: Math.min(1, questProgress(state, q, last) / questGoal(q)) });
    }
  }
  const sorted = rates.slice().sort((a, b) => b.rate - a.rate);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const res: WeekSummary = {
    start: ws,
    end: addDays(ws, 6),
    daysElapsed: days.length,
    validDays,
    xp,
    best: best ? { title: questTitle(state, best.q), rate: best.rate } : undefined,
    worst: worst && worst !== best ? { title: questTitle(state, worst.q), rate: worst.rate } : undefined,
  };
  if (days.length >= 3) res.adjustment = pickAdjustment(state, sorted.filter((r) => r.q.kind === 'daily'), last);
  return res;
}

/** Una sola pregunta de ajuste: bajar lo que más cuesta o subir lo que sale solo. */
function pickAdjustment(state: GameState, rates: { q: Quest; rate: number }[], date: string): Adjustment | undefined {
  for (const { q, rate } of rates.slice().reverse()) {
    if (rate >= 0.4) break;
    const title = questTitle(state, q);
    if (q.mode === 'counter' && (q.target ?? 1) > 1) {
      const target = Math.max(1, Math.round((q.target ?? 1) * 0.75));
      return { kind: 'lower', questId: q.id, question: `«${title}» está costando. ¿Bajamos el objetivo de ${q.target} a ${target}${q.unit ? ' ' + q.unit : ''}?`, change: { target } };
    }
    if (q.mode === 'timer' && (q.target ?? 0) > 10 && !q.tags?.includes('pomodoro')) {
      const target = Math.max(5, Math.round((q.target ?? 10) * 0.66));
      return { kind: 'lower', questId: q.id, question: `«${title}» está costando. ¿Lo dejamos en ${target} min?`, change: { target } };
    }
    // nunca proponemos pausar los pasos hacia tus metas ni el diario: son el centro del arco
    if (!q.minimumViable && !q.tags?.some((t) => t === 'goalstep' || t === 'journal')) {
      return { kind: 'lower', questId: q.id, question: `«${title}» no está encajando. ¿La pausamos por ahora? (puedes reactivarla en Ajustes)`, change: { active: false } };
    }
  }
  const top = rates[0];
  if (top && top.rate >= 0.85) {
    const phase = arcInfo(state.arc, date).phase;
    const candidate = state.quests.find((q) => q.pillar === top.q.pillar && !q.active && q.kind !== 'milestone' && phase >= (q.phaseFrom ?? 1));
    if (candidate) {
      return { kind: 'raise', questId: candidate.id, question: `«${questTitle(state, top.q)}» te sale solo. ¿Añadimos «${questTitle(state, candidate)}» a tu rutina?`, change: { active: true } };
    }
    if (top.q.mode === 'counter' && top.q.kind === 'daily') {
      const target = Math.round((top.q.target ?? 1) * 1.25 + 0.5);
      return { kind: 'raise', questId: top.q.id, question: `«${questTitle(state, top.q)}» te sale solo. ¿Subimos el objetivo a ${target}${top.q.unit ? ' ' + top.q.unit : ''}?`, change: { target } };
    }
  }
  return undefined;
}

export function applyAdjustment(state: GameState, adj: Adjustment, today: string): GameEvent[] {
  const q = state.quests.find((x) => x.id === adj.questId);
  if (!q) return [];
  Object.assign(q, adj.change);
  return recomputeDay(state, today);
}

/**
 * ¿Toca mostrar el resumen automáticamente? Devuelve la semana a resumir (0 = la actual, 1 = la anterior)
 * o null. El domingo se resume la semana en curso; si no abriste el juego ese día, la semana anterior
 * se resume la próxima vez que entres.
 */
export function summaryDue(state: GameState, today: string): 0 | 1 | null {
  const ws = weekStart(today);
  const prev = addDays(ws, -7);
  const seen = state.meta.lastSummaryWeek;
  const active = (w: string, upTo: string) => weekDays(w).some((d) => d <= upTo && (peekDay(state, d)?.xp ?? 0) > 0);
  if (weekday(today) === 6 && seen !== ws && active(ws, today)) return 0;
  if ((!seen || seen < prev) && active(prev, addDays(prev, 6))) return 1;
  return null;
}

// ---------------------------------------------------------------------------
// Historial: el edificio bajo la habitación (una planta por semana, una ventana por día)

export type DayLight = 'none' | 'future' | 'today' | 'lit' | 'bright' | 'rest' | 'off';

export function dayLight(state: GameState, date: string, today: string): DayLight {
  if (date < state.arc.start || date > state.arc.end) return 'none';
  if (date > today) return 'future';
  const d = peekDay(state, date);
  if (d?.minimumMet) return d.bonus ? 'bright' : 'lit';
  if (d?.restDay || d?.tokenUsed) return 'rest';
  return date === today ? 'today' : 'off';
}

/** Lunes de cada semana del arco (planta 1 = primera semana). */
export function arcWeeks(state: GameState): string[] {
  const out: string[] = [];
  for (let ws = weekStart(state.arc.start); ws <= state.arc.end; ws = addDays(ws, 7)) out.push(ws);
  return out;
}

// ---------------------------------------------------------------------------
// Revisión final del arco

export interface ArcReview {
  elapsed: number; // días del arco transcurridos
  total: number;
  validDays: number;
  bestStreak: number;
  xp: number;
  strongWeeks: number; // semanas con ≥5 días válidos
  journals: number;
  goals: { text: string; done: boolean; steps: number }[];
  pillars: { pillar: PillarId; rate: number }[]; // cumplimiento medio de las diarias de cada pilar
}

export function arcReview(state: GameState, today: string): ArcReview {
  const info = arcInfo(state.arc, today);
  const last = today < state.arc.end ? today : state.arc.end;
  const days: string[] = [];
  for (let d = state.arc.start; d <= last; d = addDays(d, 1)) days.push(d);
  const rates = PILLARS.map((pillar) => {
    let sum = 0, n = 0;
    for (const d of days) {
      const qs = activeQuests(state, d).filter((q) => q.pillar === pillar && q.kind === 'daily');
      if (!qs.length) continue;
      sum += qs.filter((q) => isQuestDone(state, q, d)).length / qs.length;
      n++;
    }
    return { pillar, rate: n ? sum / n : 0 };
  });
  return {
    elapsed: days.length,
    total: info.total,
    validDays: days.filter((d) => isValidDay(state, d)).length,
    bestStreak: bestStreak(state, last),
    xp: state.xp,
    strongWeeks: arcWeeks(state).filter((ws) => validDaysInWeek(state, ws) >= TOKEN_WEEK_THRESHOLD).length,
    journals: Object.values(state.log).filter((d) => d.journal).length,
    goals: state.goals.map((g) => ({ text: g.text, done: g.done, steps: goalStepCount(state, g.id) })),
    pillars: rates.sort((a, b) => b.rate - a.rate),
  };
}

/** ¿Toca la revisión final? (al terminar el arco, una vez) */
export function reviewDue(state: GameState, today: string): boolean {
  return !state.meta.reviewShown && diffDays(state.arc.end, today) > 0;
}
