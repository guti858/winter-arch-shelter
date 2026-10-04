// Utilidades compartidas por los tests.
import { activeQuests, incrementQuest, setQuestDone } from './quests';
import { createState, type GameState } from './state';

export function newGame(opts: Partial<Parameters<typeof createState>[0]> = {}): GameState {
  return createState({ start: '2026-10-05', intensity: 'normal', today: '2026-10-05', goals: ['Correr 10 km', 'Terminar el curso'], ...opts });
}

/** Completa n tareas ★ del día. */
export function doStars(state: GameState, date: string, n: number) {
  const stars = activeQuests(state, date).filter((q) => q.kind === 'daily' && q.minimumViable);
  for (const q of stars.slice(0, n)) {
    if (q.mode === 'counter') incrementQuest(state, q.id, date, q.target ?? 1);
    else setQuestDone(state, q.id, date, true);
  }
}
