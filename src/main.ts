import './ui/styles.css';
import { createInput } from './engine/input';
import { computeView, drawDebugGrid, screenToTile, setScreenTransform, type View } from './engine/renderer';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let view: View = computeView(innerWidth, innerHeight, devicePixelRatio || 1);
let hoverTile: { x: number; y: number } | null = null;

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view = computeView(window.innerWidth, window.innerHeight, dpr);
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  canvas.style.width = view.w + 'px';
  canvas.style.height = view.h + 'px';
}
window.addEventListener('resize', resize);
resize();

createInput(canvas, {
  onMove(s) {
    if (!s.inside) { hoverTile = null; return; }
    const t = screenToTile(view, s.x, s.y);
    hoverTile = t.x >= 0 && t.y >= 0 && t.x < 8 && t.y < 8 ? t : null;
  },
});

function frame() {
  setScreenTransform(ctx, view);
  ctx.fillStyle = '#0b1026';
  ctx.fillRect(0, 0, view.w, view.h);
  drawDebugGrid(ctx, view, hoverTile);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
