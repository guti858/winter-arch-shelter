// Rachas, tokens de descanso, "día malo" (modo reducido), reentrada y resumen semanal.
import { addDays, arcInfo, weekDays, weekStart, weekday } from './calendar';
import { activeQuests, isQuestDone, questGoal, questProgress, recomputeDay, type GameEvent } from './quests';
import { MAX_TOKENS, dayLog, peekDay, questTitle, type GameState, type Quest } from './state';

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
    if (weekday(d) === 6 && validDaysInWeek(state, weekStart(d)) >= TOKEN_WEEK_THRESHOLD && state.restTokens < MAX_TOKENS) {
      state.restTokens++;
      res.tokensEarned++;
    }
  }
  if (!state.meta.lastSettled || yesterday > state.meta.lastSettled) state.meta.lastSettled = yesterday;
  return res;
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
    if (!q.minimumViable) {
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

/** ¿Toca mostrar el resumen automáticamente? (domingo, una vez por semana, si hubo actividad). */
export function shouldAutoSummary(state: GameState, today: string): boolean {
  const ws = weekStart(today);
  if (weekday(today) !== 6 || state.meta.lastSummaryWeek === ws) return false;
  return weekDays(ws).some((d) => d <= today && (peekDay(state, d)?.xp ?? 0) > 0);
}
