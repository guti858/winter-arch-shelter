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

/** Simula `seconds` a 30 Hz y llama a `check` en cada paso. */
function simulate(seconds: number, hour: number, check: (t: Traffic, before: Map<Mover, number>) => void) {
  const t = new Traffic();
  const dt = 1 / 30;
  for (let i = 0; i < seconds * 30; i++) {
    const before = new Map(t.movers.map((m) => [m, m.pos]));
    t.update(dt, hour);
    check(t, before);
  }
  return t;
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
  const cars = (t: Traffic) => t.movers.filter((m) => m.kind === 'car' && m.visible);
  const walkers = (t: Traffic) => t.movers.filter((m) => m.kind === 'walker' && m.visible);

  it('los coches de un carril no se solapan', () => {
    let bad = 0;
    simulate(240, 18.5, (t) => {
      const byLane = new Map<string, Mover[]>();
      for (const m of cars(t)) {
        const k = m.axis + m.lane;
        byLane.set(k, [...(byLane.get(k) ?? []), m]);
      }
      for (const list of byLane.values()) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          if (Math.abs(list[i].pos - list[j].pos) <= (list[i].len + list[j].len) / 2) bad++;
        }
      }
    });
    expect(bad).toBe(0);
  });

  it('ningún coche cruza la línea de detención en rojo', () => {
    let crossed = 0, red = 0;
    simulate(240, 18.5, (t, before) => {
      for (const m of cars(t)) {
        const prev = before.get(m)!;
        if (Math.abs(m.pos - prev) > 1) continue; // dio la vuelta al mapa
        const f0 = prev + (m.dir * m.len) / 2, f1 = m.pos + (m.dir * m.len) / 2;
        for (let n = BANDS.from; n <= BANDS.to; n++) {
          const line = n * PITCH + (m.dir > 0 ? STOP_POS : STOP_NEG);
          if ((f0 - line) * m.dir > 0 || (f1 - line) * m.dir <= 0) continue;
          crossed++;
          const [ix, iy] = crossingOf(m, n);
          if (signalOf(axisPhase(ix, iy, m.axis, t.clock)) === 'r') red++;
        }
      }
    });
    expect(red).toBe(0);
    expect(crossed).toBeGreaterThan(50);
  });

  it('coches de ejes distintos no coinciden dentro de un cruce', () => {
    let bad = 0;
    simulate(240, 18.5, (t) => {
      const list = cars(t);
      const xs = list.filter((m) => m.axis === 'x'), ys = list.filter((m) => m.axis === 'y');
      for (const a of xs) for (const b of ys) if (hit(box(a), box(b))) bad++;
    });
    expect(bad).toBe(0);
  });

  it('los peatones solo pisan la calzada para cruzar y nadie los atropella', () => {
    let crossings = 0, waits = 0, bad = 0;
    simulate(240, 18.5, (t) => {
      const cs = cars(t);
      for (const w of walkers(t)) {
        const b = box(w);
        for (const c of cs) if (hit(b, box(c))) bad++;
        const along = w.pos - Math.floor(w.pos / PITCH) * PITCH;
        if (along > ROAD0 && along < ROAD1) crossings++;
        if (w.v === 0) waits++;
      }
    });
    expect(bad).toBe(0);
    expect(crossings).toBeGreaterThan(100);
    expect(waits).toBeGreaterThan(100);
  });

  it('de madrugada circulan menos coches que a última hora de la tarde', () => {
    const night = simulate(1, 3, () => {}), evening = simulate(1, 18.5, () => {});
    expect(cars(night).length).toBeLessThan(cars(evening).length * 0.5);
  });
});
