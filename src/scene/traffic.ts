// Tráfico de la ciudad de fondo. Lógica pura (sin DOM); city.ts solo lo dibuja.
//
// - Los coches circulan por la derecha, cada uno a su velocidad, sin adelantarse ni solaparse
//   (siguen al de delante y frenan a tiempo).
// - Cada cruce tiene semáforo: el paso alterna entre el eje x y el eje y, con ámbar y un tramo de
//   todo en rojo para vaciar el cruce. Los coches paran en la línea de detención, antes del paso de cebra.
// - Los peatones van por las aceras, esperan en el bordillo y cruzan por el paso de cebra solo
//   cuando su eje tiene verde y les da tiempo a llegar al otro lado.
//
// Plano de la ciudad: manzanas de BLOCK × BLOCK separadas por calles de STREET; las calles forman
// bandas [g·PITCH + BLOCK, (g + 1)·PITCH] en cada eje. Dentro de una banda, la acera ocupa SIDEWALK a
// cada lado y la calzada va de ROAD0 a ROAD1 (relativo a g·PITCH).
//
// Orientación: con x hacia abajo-derecha e y hacia abajo-izquierda en pantalla, la derecha de quien va
// hacia +x es +y, y la de quien va hacia +y es −x.
import { shade } from '../engine/color';
import { mulberry32 } from '../engine/random';

export const BLOCK = 8;
export const STREET = 4;
export const PITCH = BLOCK + STREET;
export const SIDEWALK = 0.8;
export const RANGE = 3; // manzanas de −3 a 3 en cada eje
export const ROAD0 = BLOCK + SIDEWALK;
export const ROAD1 = PITCH - SIDEWALK;
export const MIN = -RANGE * PITCH - STREET;
export const MAX = RANGE * PITCH + BLOCK + STREET;
const SPAN = MAX - MIN;
/** Bandas de calle (y cruces) que existen en cada eje. */
export const BANDS = { from: -RANGE - 1, to: RANGE };

export type Axis = 'x' | 'y';
export type Signal = 'g' | 'a' | 'r';

// Semáforos: verde, ámbar y todo rojo para un eje; después lo mismo para el otro.
export const GREEN = 7;
export const AMBER = 1.5;
const ALL_RED = 1.5;
const HALF = GREEN + AMBER + ALL_RED;
export const CYCLE = HALF * 2;
/** Los peatones esperan un instante tras el verde (por si un coche apura el ámbar). */
const WALK_FROM = 1;

/** Líneas de detención: el morro de quien va hacia +eje para en n·PITCH + STOP_POS; hacia −eje, en n·PITCH + STOP_NEG. */
export const STOP_POS = BLOCK - 0.22;
export const STOP_NEG = PITCH + 0.22;
const ACCEL = 1.3;
const DECEL = 3;
const CAR_GAP = 0.4;
const WALK_GAP = 0.22;

const CARS = ['#a33d3d', '#3d5ea8', '#c8cbd8', '#2d2f3d', '#d6ad48', '#4f7d5c', '#7a4f9a'];
const COATS = ['#3a3550', '#4a3f3a', '#2f3a52', '#5a3a4a', '#40504a'];
const HATS = ['#c0533f', '#d6a64a', '#6f86c9', '#e8e2d6', '#2a2b3a'];
const UMBRELLAS = ['#c0533f', '#3f6fb0', '#d6a64a', '#2d2f3d'];

export interface Mover {
  kind: 'car' | 'walker';
  axis: Axis;
  /** Coordenada fija del carril o de la acera (y si axis = x). */
  lane: number;
  /** Banda de calle a la que pertenece ese carril o esa acera. */
  band: number;
  dir: 1 | -1;
  pos: number;
  v: number;
  vmax: number;
  len: number;
  wid: number;
  h: number;
  color: string;
  rank: number; // 0..1: circula si rank < densidad
  visible: boolean;
  brake: boolean;
  /** Distancia recorrida (zancada de los peatones). */
  stride: number;
  van?: boolean;
  snow?: boolean;
  umbrella?: string;
  hat?: string;
  /** Cruce (banda) que ya ha decidido pasar: no frena por ese semáforo aunque cambie. */
  pass?: number;
}

/** Densidad de tráfico según la hora real: más bullicio al caer la tarde, calma de madrugada. */
export function trafficDensity(hour: number): number {
  const pts: [number, number][] = [[0, 0.4], [3, 0.15], [6, 0.35], [8, 0.85], [13, 0.7], [18.5, 1], [21, 0.75], [24, 0.4]];
  for (let i = 1; i < pts.length; i++) {
    const [h1, v1] = pts[i];
    const [h0, v0] = pts[i - 1];
    if (hour <= h1) return v0 + ((hour - h0) / (h1 - h0)) * (v1 - v0);
  }
  return 0.4;
}

function crossingOffset(ix: number, iy: number): number {
  const h = Math.sin(ix * 12.9898 + iy * 78.233) * 43758.5453;
  return (h - Math.floor(h)) * CYCLE;
}

/** Segundos desde que empezó el verde de ese eje en el cruce (ix, iy), en [0, CYCLE). */
export function axisPhase(ix: number, iy: number, axis: Axis, t: number): number {
  const u = (t + crossingOffset(ix, iy) + (axis === 'y' ? HALF : 0)) % CYCLE;
  return u < 0 ? u + CYCLE : u;
}

export function signalOf(u: number): Signal {
  return u < GREEN ? 'g' : u < GREEN + AMBER ? 'a' : 'r';
}

const ring = (d: number) => ((d % SPAN) + SPAN) % SPAN;

/** Cruce (ix, iy) que atraviesa un móvil de ese carril al llegar a la banda n de su eje. */
export function crossingOf(m: Pick<Mover, 'axis' | 'band'>, n: number): [number, number] {
  return m.axis === 'x' ? [n, m.band] : [m.band, n];
}

/** Línea de detención que tiene por delante un coche (índice de banda y posición). */
export function nextStopLine(m: Pick<Mover, 'pos' | 'dir' | 'len'>): { n: number; line: number } {
  const front = m.pos + (m.dir * m.len) / 2;
  // con tolerancia: quien ha parado justo en la línea sigue teniéndola delante
  const n = m.dir > 0 ? Math.ceil((front - STOP_POS - 0.05) / PITCH) : Math.floor((front - STOP_NEG + 0.05) / PITCH);
  return { n, line: n * PITCH + (m.dir > 0 ? STOP_POS : STOP_NEG) };
}

/**
 * Saca a un móvil de la zona de un cruce (entre líneas de detención, o de la calzada si es peatón):
 * hacia atrás al colocarlo al principio, hacia delante al reaparecer por el borde del mapa.
 */
function outsideCrossing(m: Mover, ahead: boolean) {
  const before = (m.dir > 0) !== ahead; // ¿al lado de menor coordenada?
  if (m.kind === 'car') {
    const n = Math.floor((m.pos - BLOCK + 1) / PITCH), u = m.pos - n * PITCH; // u ∈ [BLOCK − 1, PITCH + BLOCK − 1)
    const lo = STOP_POS - m.len / 2 - 0.3, hi = STOP_NEG + m.len / 2 + 0.3;
    if (u > lo && u < hi) m.pos = n * PITCH + (before ? lo : hi);
  } else {
    const n = Math.floor(m.pos / PITCH), u = m.pos - n * PITCH;
    if (u > BLOCK && u < PITCH) m.pos = n * PITCH + (before ? BLOCK + 0.3 : PITCH - 0.3);
  }
}

export class Traffic {
  readonly movers: Mover[];
  /** Reloj propio: semáforos y móviles comparten tiempo. */
  clock = 0;
  private lanes: Mover[][] = [];
  private primed = false;

  constructor(seed = 99) {
    const rnd = mulberry32(seed);
    const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
    for (let g = BANDS.from; g <= BANDS.to; g++) {
      const base = g * PITCH + BLOCK;
      for (const axis of ['x', 'y'] as const) {
        // por la derecha: hacia +x por el carril de mayor y; hacia +y por el de menor x
        const lanes: [number, 1 | -1][] = axis === 'x'
          ? [[base + 1.4, -1], [base + 2.6, 1]]
          : [[base + 1.4, 1], [base + 2.6, -1]];
        for (const [lane, dir] of lanes) {
          // como mucho 4 por carril: una cola en un semáforo nunca llega hasta el cruce anterior
          const n = 3 + Math.floor(rnd() * 2);
          const list: Mover[] = [];
          for (let c = 0; c < n; c++) {
            const van = rnd() < 0.15;
            list.push({
              kind: 'car', axis, lane, band: g, dir,
              pos: MIN + ((c + 0.15 + rnd() * 0.7) * SPAN) / n,
              v: 0, vmax: 1.6 + rnd() * 1.1,
              len: van ? 1.5 : 1.15, wid: van ? 0.58 : 0.54, h: van ? 0.7 : 0.54,
              color: shade(pick(CARS), -0.12), rank: rnd(), visible: true, brake: false, stride: 0,
              van, snow: rnd() < 0.5,
            });
          }
          this.lanes.push(list);
        }
        // peatones: dos sentidos por cada acera, por dentro de farolas y semáforos
        for (const [off, dir] of [[0.22, -1], [0.48, 1], [STREET - 0.48, -1], [STREET - 0.22, 1]] as [number, 1 | -1][]) {
          // sin manzana a ese lado no hay acera
          if ((g === BANDS.from && off < 1) || (g === BANDS.to && off > 1)) continue;
          const n = rnd() < 0.3 ? 0 : rnd() < 0.35 ? 2 : 1;
          const list: Mover[] = [];
          for (let c = 0; c < n; c++) {
            list.push({
              kind: 'walker', axis, lane: base + off, band: g, dir,
              pos: MIN + ((c + 0.2 + rnd() * 0.6) * SPAN) / n,
              v: 0, vmax: 0.42 + rnd() * 0.2,
              len: 0.16, wid: 0.16, h: 0.5,
              color: pick(COATS), rank: rnd(), visible: true, brake: false, stride: rnd() * 10,
              umbrella: rnd() < 0.3 ? pick(UMBRELLAS) : undefined,
              hat: rnd() < 0.6 ? pick(HATS) : undefined,
            });
          }
          if (list.length) this.lanes.push(list);
        }
      }
    }
    this.movers = this.lanes.flat();
    // nadie empieza dentro de un cruce: los coches, antes de su línea; los peatones, en la acera
    for (const m of this.movers) outsideCrossing(m, false);
  }

  signal(ix: number, iy: number, axis: Axis): Signal {
    return signalOf(axisPhase(ix, iy, axis, this.clock));
  }

  private density(m: Mover, dens: number) {
    return m.kind === 'car' ? dens : dens * 0.9 + 0.1;
  }

  update(dt: number, hour: number) {
    this.clock += dt;
    const dens = trafficDensity(hour);
    if (!this.primed) {
      // la densidad se aplica desde el primer frame, sin dejar a nadie encima de otro
      for (const m of this.movers) m.visible = false;
      for (const lane of this.lanes) for (const m of lane) m.visible = m.rank < this.density(m, dens) && this.clear(lane, m);
      this.primed = true;
    }
    for (const lane of this.lanes) {
      const vis = lane.filter((m) => m.visible).sort((a, b) => (a.pos - b.pos) * a.dir);
      vis.forEach((m, i) => {
        let gap = Infinity;
        const lead = vis.length > 1 ? vis[(i + 1) % vis.length] : undefined;
        if (lead) gap = ring((lead.pos - m.pos) * m.dir) - (lead.len + m.len) / 2 - (m.kind === 'car' ? CAR_GAP : WALK_GAP);
        if (m.kind === 'car') {
          gap = Math.min(gap, this.stopGap(m, lead, gap));
          const want = Math.min(m.vmax, Math.sqrt(2 * DECEL * Math.max(0, gap)));
          const prev = m.v;
          m.v = want < m.v ? want : Math.min(want, m.v + ACCEL * dt);
          m.v = Math.min(m.v, Math.max(0, gap) / dt); // sin pasarse de la línea en un paso largo
          m.brake = m.v < prev - 1e-3 || (m.v < 0.05 && gap < 1.2);
        } else {
          gap = Math.min(gap, this.curbGap(m));
          m.v = gap < 0.01 ? 0 : Math.min(m.vmax, gap * 4);
        }
      });
      for (const m of lane) {
        if (!m.visible) m.v = m.vmax;
        m.pos += m.v * m.dir * dt;
        m.stride += m.v * dt;
        let wrapped = false;
        if (m.pos >= MAX) { m.pos -= SPAN; wrapped = true; }
        else if (m.pos < MIN) { m.pos += SPAN; wrapped = true; }
        if (wrapped) {
          outsideCrossing(m, true);
          m.pass = undefined;
          m.visible = m.rank < this.density(m, dens) && this.clear(lane, m);
        }
      }
    }
  }

  /** ¿Hay sitio para que aparezca en su carril sin solaparse con nadie? */
  private clear(lane: Mover[], m: Mover) {
    return lane.every((o) => o === m || !o.visible || Math.min(ring(o.pos - m.pos), ring(m.pos - o.pos)) > (o.len + m.len) / 2 + 1);
  }

  /** Distancia hasta donde debe parar por el semáforo (Infinity si puede seguir). */
  private stopGap(m: Mover, lead: Mover | undefined, leadGap: number): number {
    const { n, line } = nextStopLine(m);
    if (n < BANDS.from || n > BANDS.to) return Infinity;
    if (m.pass === n) return Infinity;
    const dist = (line - (m.pos + (m.dir * m.len) / 2)) * m.dir;
    // no entra en el cruce si el de delante está parado justo a la salida y no cabría
    const room = !lead || lead.v > 0.3 || leadGap >= dist + (STOP_NEG - STOP_POS) + m.len;
    if (!room) return dist - 0.02;
    const [ix, iy] = crossingOf(m, n);
    const u = axisPhase(ix, iy, m.axis, this.clock);
    // se compromete a pasar cuando ya no podría parar con suavidad (o arranca desde la línea);
    // en ámbar, solo si va lanzado, llega a la línea antes del rojo y deja el cruce (pasos de cebra
    // incluidos) vacío antes de que acabe el todo rojo
    const late = (m.v * m.v) / (2 * DECEL) >= dist - 0.02;
    const clears = (dist + STOP_NEG - STOP_POS + m.len) / Math.max(m.v, 0.01) <= HALF - u;
    if (u < GREEN) {
      if (late || dist < 0.3) m.pass = n;
      return Infinity;
    }
    if (u < GREEN + AMBER && late && m.v > 0.5 && dist < m.v * (GREEN + AMBER - u) && clears) {
      m.pass = n;
      return Infinity;
    }
    return dist - 0.02;
  }

  /** Peatón: espera en el bordillo si no le da tiempo a cruzar con su verde. */
  private curbGap(m: Mover): number {
    const front = m.pos + (m.dir * m.len) / 2;
    const n = m.dir > 0 ? Math.ceil((front - ROAD0) / PITCH) : Math.floor((front - ROAD1) / PITCH);
    if (n < BANDS.from || n > BANDS.to) return Infinity;
    const dist = ((n * PITCH + (m.dir > 0 ? ROAD0 : ROAD1)) - front) * m.dir;
    if (dist > 0.4) return Infinity;
    const [ix, iy] = crossingOf(m, n);
    const u = axisPhase(ix, iy, m.axis, this.clock);
    const need = (ROAD1 - ROAD0 + m.len) / m.vmax + 0.5;
    return u >= WALK_FROM && u < GREEN && HALF - u >= need ? Infinity : dist - 0.02;
  }
}
