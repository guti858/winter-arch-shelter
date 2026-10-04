// Estado serializable del juego + creación inicial. Lógica pura: sin DOM ni canvas.
import questsJson from '../content/quests.json';
import pillarsJson from '../content/pillars.json';
import { arcEndFor, DEFAULT_START } from './calendar';

export type PillarId = 'cuerpo' | 'sueno' | 'foco' | 'mente' | 'nutricion' | 'orden';
export type ObjectId = 'bed' | 'desk' | 'mat' | 'shelf' | 'kitchen' | 'window' | 'plant' | 'corkboard' | 'table';
export type Intensity = 'suave' | 'normal' | 'intensa';

export const PILLARS: PillarId[] = ['cuerpo', 'sueno', 'foco', 'mente', 'nutricion', 'orden'];
export const OBJECTS: ObjectId[] = ['mat', 'bed', 'desk', 'shelf', 'kitchen', 'plant', 'table', 'window', 'corkboard'];

export type QuestKind = 'daily' | 'weekly' | 'milestone';
export type CheckMode = 'boolean' | 'counter' | 'timer' | 'text';
/** core = ★ (Suave), normal = Normal, plus = solo Intensa. */
export type Tier = 'core' | 'normal' | 'plus';

export interface Quest {
  id: string;
  pillar: PillarId;
  title: string;
  description?: string;
  kind: QuestKind;
  mode: CheckMode;
  target?: number; // counter: nº objetivo; timer: minutos
  xp: number; // 5–40 (hitos y retos, más)
  minimumViable?: boolean; // cuenta para el "día mínimo viable"
  phaseFrom?: 1 | 2 | 3; // desde qué fase aparece
  active: boolean;
  // --- extensiones (documentadas en el README)
  tier?: Tier;
  object?: ObjectId; // objeto de la escena si no es el del pilar
  unit?: string; // unidad del contador ("vasos", "entrenos"...)
  tags?: string[]; // 'pomodoro' | 'journal' | 'boss'
}

export interface Journal { good: string; improve: string; tomorrow: string }

export interface DayLog {
  done: Record<string, number>; // 0/1 o progreso
  minimumMet: boolean;
  reducedMode: boolean;
  journal?: Journal;
  // --- extensiones
  xp?: number; // XP ganado ese día (para el resumen semanal)
  bonus?: number; // bonus de "todas las diarias" concedido ese día
  restDay?: boolean; // descanso planeado con token
  tokenUsed?: boolean; // token gastado automáticamente para salvar la racha
}

export interface Goal { id: string; text: string; done: boolean }

export interface TimerState {
  questId: string | null; // null = descanso del Pomodoro
  kind: 'work' | 'break';
  minutes: number;
  endsAt: number | null; // epoch ms (null si está en pausa)
  remaining: number; // ms restantes cuando está en pausa
  date: string; // día lógico en que empezó
}

export interface GameState {
  version: 1;
  arc: { start: string; end: string; intensity: Intensity; bedtime: string };
  goals: Goal[];
  quests: Quest[];
  log: Record<string, DayLog>;
  xp: number;
  restTokens: number;
  settings: { sound: boolean; reducedMotion: boolean };
  meta: {
    createdAt: string; // día lógico de creación
    lastSettled?: string; // último día procesado (rachas/tokens)
    lastLevelSeen: number;
    lastPhaseSeen: number;
    lastSummaryWeek?: string;
    reentryShown?: string;
    timer?: TimerState | null;
    debugXp?: number; // XP añadido desde la consola de depuración
  };
}

export const STORAGE_KEY = 'winterArcRoom.v1';
export const MAX_TOKENS = 2;
export const GOAL_XP = 80;

// ---------------------------------------------------------------------------
// Contenido

export interface PillarDef { id: PillarId; name: string; icon: string; color: string; description: string }
export interface ObjectDef { pillar: PillarId; name: string; hint: string; special?: 'journal' | 'goals' }

export const PILLAR_DEFS = pillarsJson.pillars as PillarDef[];
export const OBJECT_DEFS = pillarsJson.objects as Record<ObjectId, ObjectDef>;
export const BOSS_CHALLENGES: string[] = questsJson.bossChallenges;

export type QuestTemplate = Omit<Quest, 'active'>;
export const QUEST_TEMPLATE = questsJson.quests as QuestTemplate[];

export function pillarDef(id: PillarId): PillarDef {
  return PILLAR_DEFS.find((p) => p.id === id)!;
}

/** Objeto por defecto de un pilar (el primero no especial). */
export function defaultObject(pillar: PillarId): ObjectId {
  const entry = (Object.entries(OBJECT_DEFS) as [ObjectId, ObjectDef][]).find(([, d]) => d.pillar === pillar && !d.special);
  return entry ? entry[0] : 'plant';
}

export function questObject(q: Quest): ObjectId {
  return q.object ?? defaultObject(q.pillar);
}

export function hasTag(q: Quest, tag: string) {
  return !!q.tags?.includes(tag);
}

// ---------------------------------------------------------------------------
// Creación

const TIERS_BY_INTENSITY: Record<Intensity, Tier[]> = {
  suave: ['core'],
  normal: ['core', 'normal'],
  intensa: ['core', 'normal', 'plus'],
};

/** Activa las tareas de la plantilla según la intensidad elegida. */
export function questsForIntensity(template: QuestTemplate[], intensity: Intensity): Quest[] {
  return template.map((t) => {
    const q: Quest = { ...t, tags: t.tags ? [...t.tags] : undefined, active: TIERS_BY_INTENSITY[intensity].includes(t.tier ?? 'normal') };
    // El diario cuenta como ★ solo en Normal/Intensa
    if (hasTag(q, 'journal')) q.minimumViable = intensity !== 'suave';
    return q;
  });
}

export interface NewGameOptions {
  start?: string;
  intensity?: Intensity;
  bedtime?: string;
  goals?: string[];
  today: string;
  template?: QuestTemplate[];
}

export function createState(o: NewGameOptions): GameState {
  const start = o.start ?? DEFAULT_START;
  const intensity = o.intensity ?? 'normal';
  return {
    version: 1,
    arc: { start, end: arcEndFor(start), intensity, bedtime: o.bedtime ?? '23:30' },
    goals: (o.goals ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((text, i) => ({ id: `meta-${i + 1}`, text, done: false })),
    quests: questsForIntensity(o.template ?? QUEST_TEMPLATE, intensity),
    log: {},
    xp: 0,
    restTokens: 0,
    settings: { sound: true, reducedMotion: false },
    meta: { createdAt: o.today, lastLevelSeen: 1, lastPhaseSeen: 1, timer: null },
  };
}

export function emptyDay(): DayLog {
  return { done: {}, minimumMet: false, reducedMode: false };
}

export function dayLog(state: GameState, date: string): DayLog {
  let d = state.log[date];
  if (!d) {
    d = emptyDay();
    state.log[date] = d;
  }
  return d;
}

export function peekDay(state: GameState, date: string): DayLog | undefined {
  return state.log[date];
}

export function questTitle(state: GameState, q: Quest): string {
  return q.title.replace('{hora}', state.arc.bedtime);
}
