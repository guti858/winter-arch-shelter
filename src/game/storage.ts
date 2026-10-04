// Persistencia: localStorage con guardado diferido (300 ms), memoria como respaldo,
// y export/import JSON con validación de versión.
import { isValidDate } from './calendar';
import { QUEST_TEMPLATE, STORAGE_KEY, questsForIntensity, type GameState, type Intensity } from './state';

export const SAVE_DEBOUNCE_MS = 300;

export function exportJSON(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

const INTENSITIES: Intensity[] = ['suave', 'normal', 'intensa'];

/** Valida y normaliza un objeto como GameState v1. Lanza un Error legible si no es válido. */
export function validateState(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no contiene un objeto JSON.');
  const s = raw as Partial<GameState> & Record<string, unknown>;
  if (s.version !== 1) throw new Error(`Versión no compatible (${String(s.version)}). Se esperaba la versión 1.`);
  const arc = s.arc as GameState['arc'] | undefined;
  if (!arc || !isValidDate(arc.start) || !isValidDate(arc.end) || arc.end < arc.start) throw new Error('Fechas del arco no válidas.');
  if (!INTENSITIES.includes(arc.intensity)) throw new Error('Intensidad no válida.');
  if (!Array.isArray(s.quests) || s.quests.some((q) => !q || typeof q.id !== 'string' || typeof q.xp !== 'number')) {
    throw new Error('Lista de tareas no válida.');
  }
  if (!s.log || typeof s.log !== 'object') throw new Error('Registro diario no válido.');
  for (const [k, v] of Object.entries(s.log)) {
    if (!isValidDate(k) || !v || typeof v !== 'object' || typeof (v as { done?: unknown }).done !== 'object') {
      throw new Error(`Registro del día ${k} no válido.`);
    }
  }
  if (typeof s.xp !== 'number' || !isFinite(s.xp) || s.xp < 0) throw new Error('XP no válido.');
  const state: GameState = {
    version: 1,
    arc: { start: arc.start, end: arc.end, intensity: arc.intensity, bedtime: typeof arc.bedtime === 'string' ? arc.bedtime : '23:30' },
    goals: Array.isArray(s.goals) ? s.goals.filter((g) => g && typeof g.text === 'string').slice(0, 3) : [],
    quests: s.quests,
    log: s.log,
    xp: s.xp,
    restTokens: Math.max(0, Math.min(2, Number(s.restTokens) || 0)),
    settings: { sound: s.settings?.sound ?? true, reducedMotion: s.settings?.reducedMotion ?? false },
    meta: {
      createdAt: isValidDate(s.meta?.createdAt) ? s.meta!.createdAt : arc.start,
      lastSettled: isValidDate(s.meta?.lastSettled) ? s.meta!.lastSettled : undefined,
      lastLevelSeen: Number(s.meta?.lastLevelSeen) || 1,
      lastPhaseSeen: Number(s.meta?.lastPhaseSeen) || 1,
      lastSummaryWeek: s.meta?.lastSummaryWeek,
      reentryShown: s.meta?.reentryShown,
      timer: s.meta?.timer ?? null,
      debugXp: s.meta?.debugXp,
    },
  };
  mergeTemplate(state);
  return state;
}

/** Añade tareas nuevas de la plantilla que no existan en una partida guardada. */
export function mergeTemplate(state: GameState) {
  const known = new Set(state.quests.map((q) => q.id));
  const fresh = questsForIntensity(QUEST_TEMPLATE, state.arc.intensity).filter((q) => !known.has(q.id));
  state.quests.push(...fresh);
}

export function importJSON(text: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es JSON válido.');
  }
  return validateState(raw);
}

/** Almacén con respaldo en memoria si localStorage no está disponible (modo privado). */
export class Store {
  readonly available: boolean;
  private memory: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: GameState | null = null;

  constructor(private backend: Storage | null) {
    this.available = Store.probe(backend);
  }

  static probe(backend: Storage | null): boolean {
    if (!backend) return false;
    try {
      const k = STORAGE_KEY + '.probe';
      backend.setItem(k, '1');
      backend.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  load(): GameState | null {
    const text = this.available ? this.backend!.getItem(STORAGE_KEY) : this.memory;
    if (!text) return null;
    try {
      return importJSON(text);
    } catch {
      return null;
    }
  }

  /** Guardado con debounce de 300 ms. */
  save(state: GameState) {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const text = JSON.stringify(this.pending);
    this.pending = null;
    if (this.available) {
      try {
        this.backend!.setItem(STORAGE_KEY, text);
        return;
      } catch {
        // cuota llena u otro fallo: seguimos en memoria
      }
    }
    this.memory = text;
  }

  clear() {
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.memory = null;
    if (this.available) this.backend!.removeItem(STORAGE_KEY);
  }
}
