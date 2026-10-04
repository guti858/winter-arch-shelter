import { describe, expect, it } from 'vitest';
import {
  axisPhase, BANDS, CYCLE, crossingOf, PITCH, ROAD0, ROAD1, signalOf, STOP_NEG, STOP_POS, Traffic,
  type Mover,
} from './traffic';

function box(m: Mover) {
  const hx = (m.axis === 'x' ? m.len : m.wid) / 2, hy = (m.axis === 'x' ? m.wid : m.len) / 2;
  const cx = m.axis === 'x' ? m.pos : m.lane, cy = m.axis === 'x' ? m.lane : m.pos;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}
const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Simula `seconds` a 30 Hz y cuenta cada infracción posible. */
function simulate(seed: number, hour: number, seconds: number) {
  const t = new Traffic(seed);
  const dt = 1 / 30;
  const s = { laneOverlap: 0, redRun: 0, crossings: 0, boxCrash: 0, walkerHit: 0, walkerOnRoad: 0, walkerWaits: 0 };
  for (let i = 0; i < seconds * 30; i++) {
    const before = new Map(t.movers.map((m) => [m, m.pos]));
    t.update(dt, hour);
    const cars = t.movers.filter((m) => m.kind === 'car' && m.visible);
    const walkers = t.movers.filter((m) => m.kind === 'walker' && m.visible);
    for (const m of cars) {
      // solapes en el mismo carril
      for (const o of cars) {
        if (o !== m && o.axis === m.axis && o.lane === m.lane && Math.abs(o.pos - m.pos) <= (o.len + m.len) / 2) s.laneOverlap++;
      }
      // ¿ha cruzado una línea de detención en este paso? ¿con qué semáforo?
      const prev = before.get(m)!;
      if (Math.abs(m.pos - prev) > 1) continue; // dio la vuelta al mapa
      const f0 = prev + (m.dir * m.len) / 2, f1 = m.pos + (m.dir * m.len) / 2;
      for (let n = BANDS.from; n <= BANDS.to; n++) {
        const line = n * PITCH + (m.dir > 0 ? STOP_POS : STOP_NEG);
        if ((f0 - line) * m.dir > 0 || (f1 - line) * m.dir <= 0) continue;
        s.crossings++;
        const [ix, iy] = crossingOf(m, n);
        if (signalOf(axisPhase(ix, iy, m.axis, t.clock)) === 'r') s.redRun++;
      }
    }
    const xs = cars.filter((m) => m.axis === 'x'), ys = cars.filter((m) => m.axis === 'y');
    for (const a of xs) for (const b of ys) if (hit(box(a), box(b))) s.boxCrash++;
    for (const w of walkers) {
      const b = box(w);
      for (const c of cars) if (hit(b, box(c))) s.walkerHit++;
      const along = w.pos - Math.floor(w.pos / PITCH) * PITCH;
      if (along > ROAD0 && along < ROAD1) s.walkerOnRoad++;
      if (w.v === 0) s.walkerWaits++;
    }
  }
  return { t, s };
}

describe('semáforos', () => {
  it('nunca dan paso a los dos ejes a la vez en un cruce', () => {
    for (let ix = BANDS.from; ix <= BANDS.to; ix++) {
      for (let iy = BANDS.from; iy <= BANDS.to; iy++) {
        for (let t = 0; t < CYCLE * 2; t += 0.05) {
          const x = signalOf(axisPhase(ix, iy, 'x', t)), y = signalOf(axisPhase(ix, iy, 'y', t));
          expect(x === 'r' || y === 'r').toBe(true);
        }
      }
    }
  });
});

describe('tráfico', () => {
  // varias ciudades (semillas) en hora punta y por la mañana
  const cases = [[99, 18.5], [6, 18.5], [3, 8], [11, 18.5]] as const;
  it.each(cases)('semilla %i a las %sh: sin solapes, sin saltarse rojos, sin choques ni atropellos', (seed, hour) => {
    const { s } = simulate(seed, hour, 300);
    expect(s.laneOverlap).toBe(0);
    expect(s.redRun).toBe(0);
    expect(s.boxCrash).toBe(0);
    expect(s.walkerHit).toBe(0);
    // y la ciudad se mueve: coches que pasan cruces, peatones que esperan y cruzan
    expect(s.crossings).toBeGreaterThan(100);
    expect(s.walkerOnRoad).toBeGreaterThan(100);
    expect(s.walkerWaits).toBeGreaterThan(100);
  }, 60_000);

  it('de madrugada circulan menos coches que a última hora de la tarde', () => {
    const cars = (t: Traffic) => t.movers.filter((m) => m.kind === 'car' && m.visible).length;
    const night = simulate(99, 3, 1).t, evening = simulate(99, 18.5, 1).t;
    expect(cars(night)).toBeLessThan(cars(evening) * 0.5);
  });
});
