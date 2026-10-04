// Audio sintetizado (Web Audio). Se completa en el hito 6; de momento es mudo.
export type SfxName = 'pop' | 'chime' | 'levelup' | 'bell';

export class Sfx {
  unlock(_enabled: boolean) {}
  setEnabled(_on: boolean) {}
  play(_name: SfxName) {}
}
