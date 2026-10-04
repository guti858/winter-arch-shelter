// Tipos del estado del juego (serializable). Lógica pura: sin DOM ni canvas.

export type PillarId = 'cuerpo' | 'sueno' | 'foco' | 'mente' | 'nutricion' | 'orden';
export type ObjectId = 'bed' | 'desk' | 'mat' | 'shelf' | 'kitchen' | 'window' | 'plant' | 'corkboard' | 'table';

export const PILLARS: PillarId[] = ['cuerpo', 'sueno', 'foco', 'mente', 'nutricion', 'orden'];
