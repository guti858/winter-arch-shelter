import { describe, expect, it } from 'vitest';
import {
  activeQuests, findQuest, incrementQuest, isQuestDone, minimumStatus, questProgress, saveJournal,
  setQuestDone, startTimer, tickTimer, toggleGoal, toggleQuest, bossChallenge, bossDecor,
} from './quests';
import { GOAL_XP } from './state';
import { doStars, newGame } from './testutil';

const D = '2026-10-06';

describe('tareas', () => {
  it('Normal en fase 1 tiene ~8 diarias; Suave solo ★; Intensa más', () => {
    const daily = (s: ReturnType<typeof newGame>) => activeQuests(s, D).filter((q) => q.kind === 'daily').length;
    expect(daily(newGame())).toBe(8);
    expect(daily(newGame({ intensity: 'suave' }))).toBe(6);
    expect(daily(newGame({ intensity: 'intensa' }))).toBe(11);
    // en fase 2 se desbloquean más
    expect(activeQuests(newGame(), '2026-11-03').filter((q) => q.kind === 'daily').length).toBe(11);
  });

  it('completar da XP y deshacer lo retira', () => {
    const s = newGame();
    setQuestDone(s, 'cuerpo-mover', D, true);
    expect(s.xp).toBe(20);
    expect(s.log[D].xp).toBe(20);
    setQuestDone(s, 'cuerpo-mover', D, true); // idempotente
    expect(s.xp).toBe(20);
    toggleQuest(s, 'cuerpo-mover', D);
    expect(s.xp).toBe(0);
  });

  it('contadores: suman hasta el objetivo y conceden XP al llegar', () => {
    const s = newGame();
    incrementQuest(s, 'nutri-agua', D, 1);
    expect(questProgress(s, findQuest(s, 'nutri-agua')!, D)).toBe(1);
    expect(s.xp).toBe(0);
    incrementQuest(s, 'nutri-agua', D, 20);
    expect(questProgress(s, findQuest(s, 'nutri-agua')!, D)).toBe(8);
    expect(s.xp).toBe(15);
    incrementQuest(s, 'nutri-agua', D, -1);
    expect(s.xp).toBe(0);
  });

  it('las semanales acumulan por semana (lunes a domingo)', () => {
    const s = newGame();
    const q = findQuest(s, 'cuerpo-fuerza')!;
    incrementQuest(s, q.id, '2026-10-05', 1);
    incrementQuest(s, q.id, '2026-10-07', 1);
    expect(questProgress(s, q, '2026-10-07')).toBe(2);
    incrementQuest(s, q.id, '2026-10-09', 1);
    expect(isQuestDone(s, q, '2026-10-11')).toBe(true);
    expect(s.xp).toBe(30);
    // el lunes siguiente se reinicia
    expect(questProgress(s, q, '2026-10-12')).toBe(0);
  });

  it('día mínimo viable: 3 tareas ★ (2 en modo reducido)', () => {
    const s = newGame();
    expect(minimumStatus(s, D)).toMatchObject({ done: 0, need: 3, met: false });
    doStars(s, D, 2);
    expect(s.log[D].minimumMet).toBe(false);
    doStars(s, D, 3);
    expect(s.log[D].minimumMet).toBe(true);
  });

  it('bonus del 20 % al completar todas las diarias, retirado si se deshace', () => {
    const s = newGame();
    const daily = activeQuests(s, D).filter((q) => q.kind === 'daily');
    const base = daily.reduce((a, q) => a + q.xp, 0);
    for (const q of daily) {
      if (q.mode === 'counter') incrementQuest(s, q.id, D, q.target!);
      else setQuestDone(s, q.id, D, true);
    }
    expect(s.log[D].bonus).toBe(Math.round(base * 0.2));
    expect(s.xp).toBe(base + Math.round(base * 0.2));
    setQuestDone(s, daily[0].id, D, false);
    expect(s.log[D].bonus).toBeUndefined();
    expect(s.xp).toBe(base - daily[0].xp);
  });

  it('el diario completa la tarea de texto', () => {
    const s = newGame();
    const ev = saveJournal(s, D, { good: 'Entrené', improve: '', tomorrow: 'Leer' });
    expect(ev.some((e) => e.type === 'complete')).toBe(true);
    expect(s.xp).toBe(15);
    saveJournal(s, D, { good: 'Entrené mucho', improve: '', tomorrow: 'Leer' }); // editar no repite XP
    expect(s.xp).toBe(15);
  });

  it('Pomodoro: el temporizador completa la tarea y suma al contador de bloques', () => {
    const s = newGame({ intensity: 'intensa' });
    const t0 = 1_000_000;
    startTimer(s, 'foco-pomodoro', t0, D);
    expect(tickTimer(s, t0 + 60_000, D)).toEqual([]);
    const ev = tickTimer(s, t0 + 25 * 60_000, D);
    expect(ev.some((e) => e.type === 'complete' && e.questId === 'foco-pomodoro')).toBe(true);
    expect(questProgress(s, findQuest(s, 'foco-pomodoro3')!, D)).toBe(1);
    expect(s.meta.timer?.kind).toBe('break');
  });

  it('metas del arco dan XP en el corcho', () => {
    const s = newGame();
    toggleGoal(s, s.goals[0].id, D);
    expect(s.goals[0].done).toBe(true);
    expect(s.xp).toBe(GOAL_XP);
  });

  it('reto semanal: rota cada semana y deja decoración dos semanas', () => {
    const s = newGame();
    expect(bossChallenge(s, '2026-11-02')).not.toBe(bossChallenge(s, '2026-11-09'));
    expect(activeQuests(s, '2026-10-06').some((q) => q.id === 'orden-reto')).toBe(false); // fase 1
    setQuestDone(s, 'orden-reto', '2026-11-04', true);
    expect(s.xp).toBe(60);
    expect(bossDecor(s, '2026-11-04')).not.toBeNull();
    expect(bossDecor(s, '2026-11-12')).not.toBeNull();
    expect(bossDecor(s, '2026-11-20')).toBeNull();
  });
});
