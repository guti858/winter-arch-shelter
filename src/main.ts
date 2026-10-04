import './ui/styles.css';
import { createInput } from './engine/input';
import { computeView, drawDebugGrid, drawHover, drawRoom, pick, screenToTile, setScreenTransform, type View } from './engine/renderer';
import type { SceneEnv } from './scene/objects';
import type { ObjectId } from './game/state';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let view: View = computeView(innerWidth, innerHeight, devicePixelRatio || 1);
let hoverTile: { x: number; y: number } | null = null;
let hovered: ObjectId | null = null;
const params = new URLSearchParams(location.search);

const env: SceneEnv = {
  level: Number(params.get('level') ?? 1),
  t: 0,
  meters: { cuerpo: 0, sueno: 0, foco: 0, mente: 0, nutricion: 0, orden: 0 },
  goals: [{ text: 'Terminar el curso', done: true }, { text: 'Correr 10 km', done: false }],
  bossDecor: params.has('boss') ? Number(params.get('boss')) : null,
  timerRunning: params.has('timer'),
  journalToday: false,
  reducedMotion: false,
};

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
    if (!s.inside) { hoverTile = null; hovered = null; return; }
    const t = screenToTile(view, s.x, s.y);
    hoverTile = t.x >= 0 && t.y >= 0 && t.x < 8 && t.y < 8 ? t : null;
    hovered = pick(view, env, s.x, s.y);
    canvas.style.cursor = hovered ? 'pointer' : 'default';
  },
});

function frame(now: number) {
  env.t = now / 1000;
  setScreenTransform(ctx, view);
  ctx.fillStyle = '#0b1026';
  ctx.fillRect(0, 0, view.w, view.h);
  drawRoom(ctx, view, env);
  if (params.has('grid')) drawDebugGrid(ctx, view, hoverTile);
  if (hovered) drawHover(ctx, view, hovered, env.t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
