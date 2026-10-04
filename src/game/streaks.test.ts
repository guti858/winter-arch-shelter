import { describe, expect, it } from 'vitest';
import { addDays } from './calendar';
import { canUseReduced, computeStreak, missedRun, setReducedMode, settle, shouldShowReentry, useRestToken, weekSummary, applyAdjustment } from './streaks';
import { incrementQuest, setQuestDone } from './quests';
import { doStars, newGame } from './testutil';

describe('rachas y tokens', () => {
  it('la racha cuenta días consecutivos con día mínimo viable', () => {
    const s = newGame();
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) doStars(s, d, 3);
    expect(computeStreak(s, '2026-10-07')).toBe(3);
    // hoy aún no cumplido: la racha de ayer se mantiene visible
    expect(computeStreak(s, '2026-10-08')).toBe(3);
    // un día perdido sin tokens la reinicia
    expect(computeStreak(s, '2026-10-09')).toBe(0);
  });

  it('perder la racha nunca resta XP ni nivel', () => {
    const s = newGame();
    doStars(s, '2026-10-05', 3);
    const xp = s.xp;
    settle(s, '2026-10-10');
    expect(s.xp).toBe(xp);
  });

  it('se gana 1 token por semana con ≥5 días válidos (máx. 2)', () => {
    const s = newGame();
    for (let i = 0; i < 21; i++) doStars(s, addDays('2026-10-05', i), 3);
    const r = settle(s, '2026-10-26');
    expect(r.tokensEarned).toBe(2);
    expect(s.restTokens).toBe(2);
  });

  it('un token salva la racha automáticamente un día fallado', () => {
    const s = newGame();
    for (let i = 0; i < 7; i++) doStars(s, addDays('2026-10-05', i), 3); // semana completa
    settle(s, '2026-10-12');
    expect(s.restTokens).toBe(1);
    // falla el lunes 12, cumple el martes 13
    doStars(s, '2026-10-13', 3);
    const r = settle(s, '2026-10-14');
    expect(r.tokensUsedOn).toEqual(['2026-10-12']);
    expect(s.restTokens).toBe(0);
    expect(computeStreak(s, '2026-10-13')).toBe(9);
  });

  it('no se gastan tokens si la racha ya estaba a 0', () => {
    const s = newGame();
    s.restTokens = 2;
    settle(s, '2026-10-09');
    expect(s.restTokens).toBe(2);
  });

  it('día malo: 2 tareas bastan, máximo 1 vez por semana y sin bonus', () => {
    const s = newGame();
    const d = '2026-10-06';
    setReducedMode(s, d, true);
    doStars(s, d, 2);
    expect(s.log[d].minimumMet).toBe(true);
    expect(canUseReduced(s, '2026-10-08')).toBe(false);
    expect(canUseReduced(s, '2026-10-13')).toBe(true);
  });

  it('token para planear un descanso hoy', () => {
    const s = newGame();
    s.restTokens = 1;
    expect(useRestToken(s, '2026-10-06')).toBe(true);
    expect(s.restTokens).toBe(0);
    expect(computeStreak(s, '2026-10-06')).toBe(1);
    expect(useRestToken(s, '2026-10-07')).toBe(false);
  });

  it('mensaje de reentrada tras 3 días sin cumplir', () => {
    const s = newGame();
    doStars(s, '2026-10-05', 3);
    expect(missedRun(s, '2026-10-08')).toBe(2);
    expect(shouldShowReentry(s, '2026-10-08')).toBe(false);
    expect(shouldShowReentry(s, '2026-10-09')).toBe(true);
    s.meta.reentryShown = '2026-10-09';
    expect(shouldShowReentry(s, '2026-10-09')).toBe(false);
  });

  it('resumen semanal con una pregunta de ajuste', () => {
    const s = newGame();
    for (let i = 0; i < 7; i++) {
      const d = addDays('2026-10-05', i);
      doStars(s, d, 3);
      setQuestDone(s, 'orden-cama', d, true);
      setQuestDone(s, 'nutri-casera', d, true);
      incrementQuest(s, 'nutri-agua', d, 2); // agua muy por debajo del objetivo
    }
    const sum = weekSummary(s, '2026-10-05', '2026-10-11');
    expect(sum.validDays).toBe(7);
    expect(sum.xp).toBeGreaterThan(0);
    expect(sum.best?.rate).toBe(1);
    expect(sum.adjustment?.kind).toBe('lower');
    expect(sum.adjustment?.questId).toBe('nutri-agua');
    applyAdjustment(s, sum.adjustment!, '2026-10-11');
    expect(s.quests.find((q) => q.id === 'nutri-agua')!.target).toBe(6);
  });
});
