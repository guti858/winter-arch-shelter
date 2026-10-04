// Simulación de un arco completo de 88 días: `npm run simulate`.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../engine/random';
import { addDays, arcInfo } from './calendar';
import { levelFor } from './progression';
import { activeQuests, incrementQuest, isQuestDone, saveJournal, setQuestDone, toggleGoal } from './quests';
import { computeStreak, settle, bestStreak } from './streaks';
import { createState, type Intensity } from './state';

function simulate(intensity: Intensity, adherence: number, seed = 1) {
  const rnd = mulberry32(seed);
  const s = createState({ start: '2026-10-05', intensity, today: '2026-10-05', goals: ['A', 'B', 'C'] });
  const rows: string[] = [];
  let maxStreak = 0;
  for (let i = 0; i < 88; i++) {
    const d = addDays('2026-10-05', i);
    settle(s, d);
    for (const q of activeQuests(s, d)) {
      if (q.kind === 'milestone') continue;
      if (q.kind === 'weekly') {
        if (!isQuestDone(s, q, d) && rnd() < adherence * 0.45) {
          if (q.mode === 'counter') incrementQuest(s, q.id, d, 1);
          else setQuestDone(s, q.id, d, true);
        }
        continue;
      }
      if (rnd() >= adherence) continue;
      if (q.mode === 'counter') incrementQuest(s, q.id, d, q.target ?? 1);
      else if (q.mode === 'text') saveJournal(s, d, { good: 'ok', improve: '', tomorrow: '' });
      else setQuestDone(s, q.id, d, true);
    }
    if (i === 50) setQuestDone(s, 'mente-libro', d, true);
    if (i % 30 === 29 && rnd() < adherence) toggleGoal(s, s.goals[Math.floor(i / 30)].id, d);
    const streak = computeStreak(s, d);
    maxStreak = Math.max(maxStreak, streak);
    if (i % 7 === 6 || i === 87) {
      const info = arcInfo(s.arc, d);
      rows.push(`día ${String(info.day).padStart(2)} · fase ${info.phase} · racha ${String(streak).padStart(2)} · tokens ${s.restTokens} · XP ${String(s.xp).padStart(5)} · nivel ${levelFor(s.xp, intensity)}`);
    }
  }
  return { s, rows, maxStreak, best: bestStreak(s, '2026-12-31'), level: levelFor(s.xp, intensity) };
}

describe('simulación de 88 días', () => {
  it('Normal al 75 %: ~90 % de la habitación (nivel 9–10) y rachas coherentes', () => {
    const r = simulate('normal', 0.75);
    console.log(['Normal · adherencia 75 %', ...r.rows].join('\n'));
    expect(r.level).toBeGreaterThanOrEqual(9);
    expect(r.s.restTokens).toBeLessThanOrEqual(2);
    expect(r.best).toBeGreaterThan(7);
  });

  it('Suave al 75 % también llega lejos (la curva escala con la intensidad)', () => {
    const r = simulate('suave', 0.75, 2);
    console.log(['Suave · adherencia 75 %', ...r.rows].join('\n'));
    expect(r.level).toBeGreaterThanOrEqual(8);
  });

  it('adherencia baja (35 %) progresa despacio pero nunca retrocede', () => {
    const r = simulate('normal', 0.35, 3);
    console.log(['Normal · adherencia 35 %', ...r.rows].join('\n'));
    expect(r.level).toBeGreaterThanOrEqual(3);
    expect(r.level).toBeLessThan(9);
  });

  it('adherencia perfecta llega al nivel 10 con racha de 88 días', () => {
    const r = simulate('normal', 1, 4);
    expect(r.level).toBe(10);
    expect(r.maxStreak).toBe(88);
  });
});
