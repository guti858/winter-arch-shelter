// Lógica de tareas: progreso, completado, XP, día mínimo viable, bonus, temporizadores, diario y metas.
import { addDays, arcInfo, arcWeekIndex, weekDays, weekStart } from './calendar';
import {
  BOSS_CHALLENGES, GOAL_XP, dayLog, hasTag, peekDay, questObject,
  type GameState, type Journal, type ObjectId, type Quest,
} from './state';

export const MIN_REQUIRED = 3; // ★ necesarias para el día mínimo viable
export const MIN_REQUIRED_REDUCED = 2; // en "día malo"
export const BONUS_RATE = 0.2; // +20 % si completas todas las diarias
export const BREAK_MINUTES = 5;

export type GameEvent =
  | { type: 'xp'; amount: number; object?: ObjectId; questId?: string }
  | { type: 'complete'; questId: string; object: ObjectId }
  | { type: 'uncomplete'; questId: string }
  | { type: 'minimum' }
  | { type: 'allDone'; amount: number }
  | { type: 'goal'; goalId: string; done: boolean }
  | { type: 'timerDone'; questId: string | null; kind: 'work' | 'break' };

// ---------------------------------------------------------------------------
// Consultas

export function findQuest(state: GameState, id: string): Quest | undefined {
  return state.quests.find((q) => q.id === id);
}

/** Tareas activas ese día (activas + desbloqueadas por fase). */
export function activeQuests(state: GameState, date: string): Quest[] {
  const phase = arcInfo(state.arc, date).phase;
  return state.quests.filter((q) => q.active && phase >= (q.phaseFrom ?? 1));
}

/** Días que cuentan para el progreso de la tarea vista desde `date`. */
function scopeDays(state: GameState, q: Quest, date: string): string[] {
  if (q.kind === 'daily') return [date];
  if (q.kind === 'weekly') return weekDays(weekStart(date)).filter((d) => d <= date);
  return Object.keys(state.log).filter((d) => d <= date);
}

export function questProgress(state: GameState, q: Quest, date: string): number {
  let sum = 0;
  for (const d of scopeDays(state, q, date)) sum += peekDay(state, d)?.done[q.id] ?? 0;
  return sum;
}

export function questGoal(q: Quest): number {
  return q.mode === 'counter' ? Math.max(1, q.target ?? 1) : 1;
}

export function isComplete(q: Quest, progress: number): boolean {
  return progress >= questGoal(q);
}

export function questRatio(q: Quest, progress: number): number {
  return Math.max(0, Math.min(1, progress / questGoal(q)));
}

export function isQuestDone(state: GameState, q: Quest, date: string): boolean {
  return isComplete(q, questProgress(state, q, date));
}

// ---------------------------------------------------------------------------
// XP

export function award(state: GameState, date: string, amount: number) {
  if (!amount) return;
  const d = dayLog(state, date);
  state.xp = Math.max(0, state.xp + amount);
  d.xp = (d.xp ?? 0) + amount;
}

// ---------------------------------------------------------------------------
// Día mínimo viable y bonus

export function requiredMinimum(starCount: number, reduced: boolean): number {
  return Math.min(reduced ? MIN_REQUIRED_REDUCED : MIN_REQUIRED, starCount);
}

export interface MinimumStatus { done: number; need: number; met: boolean; stars: Quest[] }

export function minimumStatus(state: GameState, date: string): MinimumStatus {
  const d = peekDay(state, date);
  const daily = activeQuests(state, date).filter((q) => q.kind === 'daily');
  const stars = daily.filter((q) => q.minimumViable);
  const reduced = !!d?.reducedMode;
  if (stars.length === 0) {
    const any = daily.some((q) => isQuestDone(state, q, date));
    return { done: any ? 1 : 0, need: 1, met: any, stars };
  }
  const done = stars.filter((q) => isQuestDone(state, q, date)).length;
  const need = requiredMinimum(stars.length, reduced);
  return { done, need, met: done >= need, stars };
}

/** Recalcula mínimo viable y bonus del día; concede o retira el bonus. */
export function recomputeDay(state: GameState, date: string): GameEvent[] {
  const events: GameEvent[] = [];
  const d = dayLog(state, date);
  const wasMet = d.minimumMet;
  d.minimumMet = minimumStatus(state, date).met;
  if (!wasMet && d.minimumMet) events.push({ type: 'minimum' });

  const daily = activeQuests(state, date).filter((q) => q.kind === 'daily');
  const all = daily.length > 0 && !d.reducedMode && daily.every((q) => isQuestDone(state, q, date));
  if (all && !d.bonus) {
    const amount = Math.round(BONUS_RATE * daily.reduce((s, q) => s + q.xp, 0));
    award(state, date, amount);
    d.bonus = amount;
    events.push({ type: 'allDone', amount }, { type: 'xp', amount });
  } else if (!all && d.bonus) {
    award(state, date, -d.bonus);
    events.push({ type: 'xp', amount: -d.bonus });
    delete d.bonus;
  }
  return events;
}

// ---------------------------------------------------------------------------
// Cambios de progreso

function withCompletion(state: GameState, q: Quest, date: string, mutate: () => void): GameEvent[] {
  const before = isQuestDone(state, q, date);
  mutate();
  const after = isQuestDone(state, q, date);
  const events: GameEvent[] = [];
  const object = questObject(q);
  if (!before && after) {
    award(state, date, q.xp);
    events.push({ type: 'complete', questId: q.id, object }, { type: 'xp', amount: q.xp, object, questId: q.id });
  } else if (before && !after) {
    award(state, date, -q.xp);
    events.push({ type: 'uncomplete', questId: q.id }, { type: 'xp', amount: -q.xp, object, questId: q.id });
  }
  return events.concat(recomputeDay(state, date));
}

/** Marca/desmarca una tarea de tipo sí/no (boolean, timer o text marcados a mano). */
export function setQuestDone(state: GameState, id: string, date: string, done: boolean): GameEvent[] {
  const q = findQuest(state, id);
  if (!q) return [];
  return withCompletion(state, q, date, () => {
    if (done) {
      const missing = questGoal(q) - questProgress(state, q, date);
      if (missing > 0) {
        const log = dayLog(state, date);
        log.done[q.id] = (log.done[q.id] ?? 0) + missing;
      }
    } else {
      for (const d of scopeDays(state, q, date)) {
        const log = peekDay(state, d);
        if (log && log.done[q.id] !== undefined) delete log.done[q.id];
      }
    }
  });
}

export function toggleQuest(state: GameState, id: string, date: string): GameEvent[] {
  const q = findQuest(state, id);
  if (!q) return [];
  return setQuestDone(state, id, date, !isQuestDone(state, q, date));
}

/** Suma/resta en un contador. Nunca supera el objetivo ni baja de 0. */
export function incrementQuest(state: GameState, id: string, date: string, delta: number): GameEvent[] {
  const q = findQuest(state, id);
  if (!q) return [];
  return withCompletion(state, q, date, () => {
    if (delta > 0) {
      const add = Math.min(delta, questGoal(q) - questProgress(state, q, date));
      if (add <= 0) return;
      const log = dayLog(state, date);
      log.done[q.id] = (log.done[q.id] ?? 0) + add;
      return;
    }
    // restar: primero de hoy, luego de los días más recientes del alcance
    let left = -delta;
    const days = scopeDays(state, q, date).slice().reverse();
    for (const d of days) {
      const log = peekDay(state, d);
      const v = log?.done[q.id] ?? 0;
      if (!log || v <= 0) continue;
      const take = Math.min(v, left);
      log.done[q.id] = v - take;
      if (log.done[q.id] === 0) delete log.done[q.id];
      left -= take;
      if (left <= 0) break;
    }
  });
}

// ---------------------------------------------------------------------------
// Temporizadores (Pomodoro / lectura / meditación)

export function startTimer(state: GameState, questId: string, now: number, date: string) {
  const q = findQuest(state, questId);
  if (!q) return;
  const minutes = q.target ?? 25;
  state.meta.timer = { questId, kind: 'work', minutes, endsAt: now + minutes * 60_000, remaining: minutes * 60_000, date };
}

export function startBreak(state: GameState, now: number, date: string) {
  state.meta.timer = { questId: null, kind: 'break', minutes: BREAK_MINUTES, endsAt: now + BREAK_MINUTES * 60_000, remaining: BREAK_MINUTES * 60_000, date };
}

export function pauseTimer(state: GameState, now: number) {
  const t = state.meta.timer;
  if (!t || t.endsAt === null) return;
  t.remaining = Math.max(0, t.endsAt - now);
  t.endsAt = null;
}

export function resumeTimer(state: GameState, now: number) {
  const t = state.meta.timer;
  if (!t || t.endsAt !== null) return;
  t.endsAt = now + t.remaining;
}

export function cancelTimer(state: GameState) {
  state.meta.timer = null;
}

export function timerRemaining(state: GameState, now: number): number {
  const t = state.meta.timer;
  if (!t) return 0;
  return t.endsAt === null ? t.remaining : Math.max(0, t.endsAt - now);
}

/** Comprueba si el temporizador ha llegado a 0; si es así completa la tarea (y suma Pomodoros). */
export function tickTimer(state: GameState, now: number, date: string): GameEvent[] {
  const t = state.meta.timer;
  if (!t || t.endsAt === null || now < t.endsAt) return [];
  if (t.kind === 'break') {
    state.meta.timer = null;
    return [{ type: 'timerDone', questId: null, kind: 'break' }];
  }
  const events: GameEvent[] = [{ type: 'timerDone', questId: t.questId, kind: 'work' }];
  const q = t.questId ? findQuest(state, t.questId) : undefined;
  state.meta.timer = null;
  if (q) {
    if (q.mode !== 'counter' && !isQuestDone(state, q, date)) events.push(...setQuestDone(state, q.id, date, true));
    if (q.mode === 'counter') events.push(...incrementQuest(state, q.id, date, 1));
    if (hasTag(q, 'pomodoro')) {
      for (const other of activeQuests(state, date)) {
        if (other.id !== q.id && hasTag(other, 'pomodoro') && other.mode === 'counter') {
          events.push(...incrementQuest(state, other.id, date, 1));
        }
      }
      startBreak(state, now, date);
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Diario nocturno

export function journalQuest(state: GameState): Quest | undefined {
  return state.quests.find((q) => hasTag(q, 'journal'));
}

export function saveJournal(state: GameState, date: string, entry: Journal): GameEvent[] {
  const clean: Journal = { good: entry.good.trim(), improve: entry.improve.trim(), tomorrow: entry.tomorrow.trim() };
  const hasText = !!(clean.good || clean.improve || clean.tomorrow);
  const d = dayLog(state, date);
  if (hasText) d.journal = clean;
  else delete d.journal;
  const q = journalQuest(state);
  if (!q || !q.active) return [];
  if (hasText === isQuestDone(state, q, date)) return [];
  return setQuestDone(state, q.id, date, hasText);
}

// ---------------------------------------------------------------------------
// Metas del arco (corcho)

export function toggleGoal(state: GameState, goalId: string, date: string): GameEvent[] {
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) return [];
  g.done = !g.done;
  const amount = g.done ? GOAL_XP : -GOAL_XP;
  award(state, date, amount);
  return [{ type: 'goal', goalId, done: g.done }, { type: 'xp', amount, object: 'corkboard' }];
}

export function addGoal(state: GameState, text: string) {
  const t = text.trim();
  if (!t || state.goals.length >= 3) return;
  const n = state.goals.reduce((m, g) => Math.max(m, Number(g.id.split('-')[1]) || 0), 0) + 1;
  state.goals.push({ id: `meta-${n}`, text: t, done: false });
}

// ---------------------------------------------------------------------------
// Reto semanal "jefe" (fases 2 y 3)

export function bossQuest(state: GameState): Quest | undefined {
  return state.quests.find((q) => hasTag(q, 'boss'));
}

export function bossChallenge(state: GameState, date: string): string {
  const i = arcWeekIndex(state.arc.start, date);
  return BOSS_CHALLENGES[((i % BOSS_CHALLENGES.length) + BOSS_CHALLENGES.length) % BOSS_CHALLENGES.length];
}

/** Decoración temporal: visible la semana en que se cumple el reto y la siguiente. */
export function bossDecor(state: GameState, date: string): number | null {
  const q = bossQuest(state);
  if (!q) return null;
  for (const ws of [weekStart(date), addDays(weekStart(date), -7)]) {
    if (isQuestDone(state, q, ws === weekStart(date) ? date : addDays(ws, 6))) return arcWeekIndex(state.arc.start, ws);
  }
  return null;
}
