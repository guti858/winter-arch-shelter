import './ui/styles.css';
import { createInput } from './engine/input';
import { pick, Renderer } from './engine/renderer';
import type { SceneEnv } from './scene/objects';
import type { ObjectId } from './game/state';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
let hovered: ObjectId | null = null;
const params = new URLSearchParams(location.search);
const m = Number(params.get('m') ?? 0);

const env: SceneEnv = {
  level: Number(params.get('level') ?? 1),
  phase: Number(params.get('phase') ?? 1) as 1 | 2 | 3,
  t: 0,
  meters: { cuerpo: m, sueno: m, foco: m, mente: m, nutricion: m, orden: m },
  glow: { bed: m, desk: m, mat: m, shelf: m, kitchen: m, window: m, plant: m, corkboard: m, table: m },
  flash: {},
  goals: [{ text: 'Terminar el curso', done: true }, { text: 'Correr 10 km', done: false }],
  bossDecor: params.has('boss') ? Number(params.get('boss')) : null,
  timerRunning: params.has('timer'),
  journalToday: false,
  reducedMotion: false,
};

window.addEventListener('resize', () => renderer.resize());

const pointer = createInput(canvas, {
  onMove(s) {
    hovered = s.inside ? pick(renderer.view, env, s.x, s.y) : null;
    canvas.style.cursor = hovered ? 'pointer' : 'default';
  },
  onTap(s) {
    const target = pick(renderer.view, env, s.x, s.y);
    if (!target) return;
    const [x, y] = renderer.anchorOf(target);
    renderer.particles.burst(x, y);
    renderer.particles.text(x, y - 10, '+20 XP');
    env.flash[target] = 1;
  },
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  env.t = now / 1000;
  for (const k of Object.keys(env.flash) as ObjectId[]) env.flash[k] = Math.max(0, (env.flash[k] ?? 0) - dt * 0.8);
  renderer.frame(env, dt, pointer, hovered);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
