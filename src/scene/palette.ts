// Paletas: materiales (colores "reales", antes de la luz) y ambiente por nivel/fase.
import { mix, mixHex, type RGB } from '../engine/color';

/** Colores base de materiales. La capa de luz (multiply) los oscurece de noche. */
export const MAT = {
  floorA: '#a3866b',
  floorB: '#977a61',
  floorLine: '#6f5846',
  slabLeft: '#3a3456',
  slabRight: '#2a2542',
  wallLeft: '#7a80a6', // cara interior pared izquierda (x = 0)
  wallRight: '#8c92b6', // cara interior pared derecha (y = 0)
  wallEnd: '#4b5078',
  wallCap: '#e8efff', // nieve sobre las paredes
  baseboard: '#5a5f82',
  wood: '#a07a5a',
  woodDark: '#6e4f3b',
  woodLight: '#c19a74',
  metal: '#555a70',
  dark: '#23263a',
  screen: '#4fa3dc',
  white: '#eceaf3',
  cork: '#c08d5b',
  terracotta: '#b9674b',
  leaf: '#5e9a5a',
  leafDark: '#3f7244',
  leafDull: '#7d8a5c',
  cardboard: '#b48a5e',
  fabric: '#8a8fa8',
  mat: '#4c9a91',
  counter: '#cfcadb',
  stone: '#56596d',
  fridge: '#e2e6f0',
  rug: '#9b4f4f',
  rugBorder: '#e0c08a',
  curtain: '#8e5a7a',
} as const;

/** Color de la manta según el nivel ("manta cambia de color con el nivel"). */
export function blanketColor(level: number): string {
  if (level >= 10) return '#d98b4a';
  if (level >= 8) return '#c4643f';
  if (level >= 5) return '#7a5fae';
  return '#4f6fb9';
}

export const BOOK_COLORS = ['#c0533f', '#3f6fb0', '#d6a64a', '#4f8f6a', '#8c5aa8', '#d9d2c0', '#2f4a7a', '#b5794a', '#6aa3b8'];

export interface Ambient {
  /** Color de la luz ambiental (capa multiply). */
  ambient: RGB;
  /** Color de las luces cálidas. */
  warm: RGB;
  /** Multiplicador global de luces cálidas (progreso). */
  warmBoost: number;
  /** Brillo de las ventanas de la ciudad. */
  cityGlow: number;
  /** Tinte de la nieve. */
  snow: RGB;
}

const PHASE_TINT: Record<1 | 2 | 3, string> = {
  1: '#6f7fd0', // Cimientos: frío, azulado
  2: '#7d78c8', // Construcción: violeta
  3: '#8f78b4', // Remate: lavanda cálida
};

export function getAmbient(level: number, phase: 1 | 2 | 3): Ambient {
  const t = Math.max(0, Math.min(1, (level - 1) / 9));
  const base = mix('#3a4278', PHASE_TINT[phase], 0.35);
  const ambient = mix(base, mix('#8f88b8', '#b09a9a', phase === 3 ? 0.5 : 0.2), t * 0.55);
  const warm = mix('#ffb347', phase === 3 ? '#ffc97a' : '#ffb06a', 0.5);
  return {
    ambient,
    warm,
    warmBoost: 0.75 + t * 0.45,
    cityGlow: 0.72 + t * 0.32,
    snow: level >= 10 ? mix('#ffffff', '#ffe2a8', 0.35) : mix('#ffffff', '#cfe6ff', 0.4),
  };
}

export const UI = {
  bgTop: '#0b1026',
  bgBottom: '#1b1740',
  warm: '#ffb347',
  warm2: '#ffd98a',
  ice: '#7fd6ff',
  text: '#e8ecff',
};

export const skyAt = (t: number) => mixHex('#0b1026', '#2a1f52', t);
