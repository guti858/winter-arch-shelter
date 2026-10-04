import { describe, expect, it } from 'vitest';
import { addDays, arcEndFor, arcInfo, diffDays, isValidDate, logicalDate, phaseLengths, weekStart, weekday } from './calendar';

const ARC = { start: '2026-10-05', end: '2026-12-31' };

describe('calendar', () => {
  it('el día lógico cambia a las 04:00 locales, no a medianoche', () => {
    expect(logicalDate(new Date(2026, 9, 20, 3, 59))).toBe('2026-10-19');
    expect(logicalDate(new Date(2026, 9, 20, 4, 0))).toBe('2026-10-20');
    expect(logicalDate(new Date(2026, 9, 20, 23, 59))).toBe('2026-10-20');
    expect(logicalDate(new Date(2026, 10, 1, 0, 30))).toBe('2026-10-31'); // cruza de mes
  });

  it('aritmética de fechas sin depender del horario de verano', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // fin del horario de verano (ES)
    expect(diffDays('2026-10-05', '2026-12-31')).toBe(87);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('la semana empieza el lunes', () => {
    expect(weekday('2026-10-05')).toBe(0); // lunes
    expect(weekday('2026-10-04')).toBe(6); // domingo
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });

  it('arco por defecto: 88 días con fases 28/35/25', () => {
    expect(phaseLengths(88)).toEqual([28, 35, 25]);
    expect(arcInfo(ARC, '2026-10-05')).toMatchObject({ status: 'active', day: 1, total: 88, phase: 1, phaseName: 'Cimientos' });
    expect(arcInfo(ARC, '2026-11-01')).toMatchObject({ day: 28, phase: 1 });
    expect(arcInfo(ARC, '2026-11-02')).toMatchObject({ day: 29, phase: 2, phaseName: 'Construcción' });
    expect(arcInfo(ARC, '2026-12-06')).toMatchObject({ day: 63, phase: 2 });
    expect(arcInfo(ARC, '2026-12-07')).toMatchObject({ day: 64, phase: 3, phaseName: 'Remate' });
    expect(arcInfo(ARC, '2026-12-31')).toMatchObject({ day: 88, phase: 3, daysLeft: 1 });
    expect(arcInfo(ARC, '2026-10-05').phaseStarts).toEqual(['2026-10-05', '2026-11-02', '2026-12-07']);
  });

  it('antes y después del arco', () => {
    expect(arcInfo(ARC, '2026-10-03')).toMatchObject({ status: 'pre', day: 0, daysUntilStart: 2, phase: 1 });
    expect(arcInfo(ARC, '2027-01-02')).toMatchObject({ status: 'post', day: 88, phase: 3 });
  });

  it('si se empieza más tarde, el arco termina igualmente el 31/12', () => {
    expect(arcEndFor('2026-11-15')).toBe('2026-12-31');
    const info = arcInfo({ start: '2026-11-15', end: '2026-12-31' }, '2026-11-15');
    expect(info.total).toBe(47);
    const [a, b, c] = phaseLengths(47);
    expect(a + b + c).toBe(47);
    expect(Math.min(a, b, c)).toBeGreaterThan(0);
  });

  it('valida fechas', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('hoy')).toBe(false);
  });
});
