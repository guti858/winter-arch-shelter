// Mecánicas añadidas tras la auditoría: periodo de gracia, pasos hacia metas, prioridad del día,
// resumen atrasado, historial del edificio y revisión final.
import { describe, expect, it } from 'vitest';
import { addDays } from './calendar';
import {
  activeQuests, dayPriority, goalStepCount, isQuestDone, saveJournal, setQuestDone, toggleGoal, toggleGoalStep, togglePriority,
} from './quests';
import {
  arcReview, arcWeeks, canEditDate, computeStreak, dayLight, recheckWeekToken, reviewDue, settle, summaryDue,
} from './streaks';
import { GOAL_XP, PRIORITY_XP } from './state';
import { doStars, newGame } from './testutil';

describe('periodo de gracia (ayer)', () => {
  it('solo hoy y ayer son editables', () => {
    const s = newGame({ today: '2026-10-05' });
    expect(canEditDate(s, '2026-10-08', '2026-10-08')).toBe(true);
    expect(canEditDate(s, '2026-10-07', '2026-10-08')).toBe(true);
    expect(canEditDate(s, '2026-10-06', '2026-10-08')).toBe(false);
    // no antes de crear la partida
    expect(canEditDate(s, '2026-10-04', '2026-10-05')).toBe(false);
  });

  it('completar ayer devuelve el token que salvó la racha', () => {
    const s = newGame();
    for (let i = 0; i < 7; i++) doStars(s, addDays('2026-10-05', i), 3);
    settle(s, '2026-10-12');
    expect(s.restTokens).toBe(1);
    // el lunes 12 no se marca nada; el martes el token lo salva al cerrar el día
    settle(s, '2026-10-13');
    expect(s.log['2026-10-12'].tokenUsed).toBe(true);
    expect(s.restTokens).toBe(0);
    // ...pero el martes completas lo del lunes desde "Ayer": el token vuelve
    doStars(s, '2026-10-12', 3);
    expect(s.log['2026-10-12'].tokenUsed).toBeUndefined();
    expect(s.restTokens).toBe(1);
    expect(computeStreak(s, '2026-10-13')).toBe(8);
  });

  it('completar el domingo desde el lunes también cuenta para el token semanal', () => {
    const s = newGame();
    for (let i = 0; i < 4; i++) doStars(s, addDays('2026-10-05', i), 3); // lun–jue
    doStars(s, '2026-10-10', 3); // sábado → 5 días, falta el domingo… no, ya son 5
    const t0 = s.restTokens;
    settle(s, '2026-10-12');
    expect(s.restTokens).toBe(t0 + 1);
    // la misma semana no se vuelve a premiar
    expect(recheckWeekToken(s, '2026-10-12')).toBe(false);

    const s2 = newGame();
    for (let i = 0; i < 4; i++) doStars(s2, addDays('2026-10-05', i), 3); // 4 días
    settle(s2, '2026-10-12');
    expect(s2.restTokens).toBe(0);
    doStars(s2, '2026-10-11', 3); // el lunes marca el domingo → 5 días
    expect(recheckWeekToken(s2, '2026-10-12')).toBe(true);
    expect(s2.restTokens).toBe(1);
  });
});

describe('pasos hacia las metas', () => {
  it('el primer paso del día completa la tarea diaria y suma al contador de la meta', () => {
    const s = newGame();
    const d = '2026-10-06';
    const g = s.goals[0].id;
    toggleGoalStep(s, g, d);
    expect(goalStepCount(s, g)).toBe(1);
    expect(isQuestDone(s, s.quests.find((q) => q.id === 'metas-paso')!, d)).toBe(true);
    expect(s.xp).toBe(15);
    // un segundo paso el mismo día (otra meta) no da más XP
    toggleGoalStep(s, s.goals[1].id, d);
    expect(s.xp).toBe(15);
    toggleGoalStep(s, g, '2026-10-07');
    expect(goalStepCount(s, g)).toBe(2);
  });

  it('desmarcar el último paso deshace la tarea', () => {
    const s = newGame();
    const d = '2026-10-06';
    toggleGoalStep(s, s.goals[0].id, d);
    toggleGoalStep(s, s.goals[0].id, d);
    expect(s.xp).toBe(0);
    expect(s.log[d].goalSteps).toBeUndefined();
  });

  it('sin metas abiertas la tarea desaparece (no bloquea el bonus)', () => {
    const s = newGame();
    const d = '2026-10-06';
    expect(activeQuests(s, d).some((q) => q.id === 'metas-paso')).toBe(true);
    for (const g of s.goals) toggleGoal(s, g.id, d);
    expect(s.xp).toBe(GOAL_XP * s.goals.length);
    expect(activeQuests(s, d).some((q) => q.id === 'metas-paso')).toBe(false);
  });
});

describe('prioridad del día', () => {
  it('sale de la "prioridad de mañana" del diario de ayer', () => {
    const s = newGame();
    expect(dayPriority(s, '2026-10-07')).toBeNull();
    saveJournal(s, '2026-10-06', { good: 'ok', improve: '', tomorrow: 'Enviar el informe' });
    expect(dayPriority(s, '2026-10-07')).toBe('Enviar el informe');
    const xp = s.xp;
    togglePriority(s, '2026-10-07');
    expect(s.xp).toBe(xp + PRIORITY_XP);
    togglePriority(s, '2026-10-07');
    expect(s.xp).toBe(xp);
  });
});

describe('resumen semanal atrasado', () => {
  it('el domingo resume la semana; si no entraste, se resume la anterior al volver', () => {
    const s = newGame();
    doStars(s, '2026-10-06', 3);
    expect(summaryDue(s, '2026-10-10')).toBeNull(); // sábado
    expect(summaryDue(s, '2026-10-11')).toBe(0); // domingo
    expect(summaryDue(s, '2026-10-13')).toBe(1); // martes siguiente sin haberla visto
    s.meta.lastSummaryWeek = '2026-10-05';
    expect(summaryDue(s, '2026-10-13')).toBeNull();
  });
});

describe('historial del edificio', () => {
  it('una planta por semana del arco y una luz por día', () => {
    const s = newGame();
    expect(arcWeeks(s)).toHaveLength(13);
    doStars(s, '2026-10-05', 3);
    s.log['2026-10-07'] = { done: {}, minimumMet: false, reducedMode: false, tokenUsed: true };
    const today = '2026-10-08';
    expect(dayLight(s, '2026-10-04', today)).toBe('none'); // antes del arco
    expect(dayLight(s, '2026-10-05', today)).toBe('lit');
    expect(dayLight(s, '2026-10-06', today)).toBe('off');
    expect(dayLight(s, '2026-10-07', today)).toBe('rest');
    expect(dayLight(s, today, today)).toBe('today');
    expect(dayLight(s, '2026-10-09', today)).toBe('future');
  });
});

describe('revisión final', () => {
  it('resume el arco y se ofrece al terminar', () => {
    const s = newGame();
    for (let i = 0; i < 10; i++) doStars(s, addDays('2026-10-05', i), 3);
    toggleGoalStep(s, s.goals[0].id, '2026-10-06');
    setQuestDone(s, 'orden-cama', '2026-10-06', true);
    const r = arcReview(s, '2026-10-20');
    expect(r.elapsed).toBe(16);
    expect(r.validDays).toBe(10);
    expect(r.bestStreak).toBe(10);
    expect(r.goals[0].steps).toBe(1);
    expect(r.pillars).toHaveLength(6);
    expect(reviewDue(s, '2026-12-31')).toBe(false);
    expect(reviewDue(s, '2027-01-01')).toBe(true);
  });
});
