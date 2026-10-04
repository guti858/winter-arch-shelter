// Entrada de ratón/touch: posición, hover y clic, con picking delegado.

export interface PointerState {
  x: number; // px CSS
  y: number;
  inside: boolean;
  /** −1..1 respecto al centro de la ventana (para parallax). */
  nx: number;
  ny: number;
  isTouch: boolean;
}

export interface InputHandlers {
  onMove?: (s: PointerState) => void;
  onTap?: (s: PointerState) => void;
}

export function createInput(canvas: HTMLCanvasElement, handlers: InputHandlers) {
  const state: PointerState = { x: -1, y: -1, inside: false, nx: 0, ny: 0, isTouch: false };
  let downAt: { x: number; y: number; t: number } | null = null;

  const update = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    state.x = e.clientX - r.left;
    state.y = e.clientY - r.top;
    state.inside = true;
    state.isTouch = e.pointerType === 'touch';
    state.nx = (state.x / r.width) * 2 - 1;
    state.ny = (state.y / r.height) * 2 - 1;
  };

  canvas.addEventListener('pointermove', (e) => {
    update(e);
    handlers.onMove?.(state);
  });
  canvas.addEventListener('pointerdown', (e) => {
    update(e);
    downAt = { x: state.x, y: state.y, t: performance.now() };
    handlers.onMove?.(state);
  });
  canvas.addEventListener('pointerup', (e) => {
    update(e);
    if (downAt && Math.hypot(state.x - downAt.x, state.y - downAt.y) < 12) handlers.onTap?.(state);
    downAt = null;
    // en touch no hay hover persistente
    if (state.isTouch) {
      state.inside = false;
      handlers.onMove?.(state);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    state.inside = false;
    handlers.onMove?.(state);
  });

  return state;
}
