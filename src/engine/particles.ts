// Partículas: nieve en dos planos y un sistema genérico (chispas, texto de XP, vapor, polvo).
import { rgba, type RGB } from './color';

// ---------------------------------------------------------------------------
// Nieve

interface Flake { x: number; y: number; r: number; speed: number; phase: number; drift: number; gold: boolean }

export class Snow {
  private back: Flake[] = [];
  private front: Flake[] = [];
  private w = 0;
  private h = 0;
  /** Número de copos activos por plano (se ajusta suavemente). */
  private target = 120;
  private active = 120;

  resize(w: number, h: number) {
    this.w = w; this.h = h;
    const make = (front: boolean): Flake => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: front ? 1.5 + Math.random() * 1.6 : 0.5 + Math.random() * 0.9,
      speed: front ? 34 + Math.random() * 30 : 11 + Math.random() * 14,
      phase: Math.random() * Math.PI * 2,
      drift: 6 + Math.random() * 18,
      gold: Math.random() < 0.18,
    });
    if (!this.back.length) {
      this.back = Array.from({ length: 260 }, () => make(false));
      this.front = Array.from({ length: 160 }, () => make(true));
    } else {
      for (const f of [...this.back, ...this.front]) { f.x = Math.random() * w; f.y = Math.random() * h; }
    }
  }

  /** count: copos totales (~120 en la fase 1). */
  setIntensity(count: number) { this.target = count; }

  update(dt: number, t: number, wind: number) {
    this.active += (this.target - this.active) * Math.min(1, dt * 0.5);
    const step = (arr: Flake[], n: number) => {
      for (let i = 0; i < n && i < arr.length; i++) {
        const f = arr[i];
        f.y += f.speed * dt;
        f.x += (Math.sin(t * 0.8 + f.phase) * f.drift * 0.6 + wind) * dt;
        if (f.y > this.h + 4) { f.y = -4; f.x = Math.random() * this.w; }
        if (f.x > this.w + 4) f.x = -4;
        if (f.x < -4) f.x = this.w + 4;
      }
    };
    const [nb, nf] = this.counts();
    step(this.back, nb);
    step(this.front, nf);
  }

  private counts(): [number, number] {
    const n = Math.round(this.active);
    return [Math.round(n * 0.62), Math.round(n * 0.38)];
  }

  draw(ctx: CanvasRenderingContext2D, plane: 'back' | 'front', color: RGB, golden: boolean) {
    const [nb, nf] = this.counts();
    const arr = plane === 'back' ? this.back : this.front;
    const n = plane === 'back' ? nb : nf;
    const base = rgba(color, plane === 'back' ? 0.55 : 0.85);
    ctx.fillStyle = base;
    for (let i = 0; i < n && i < arr.length; i++) {
      const f = arr[i];
      if (golden && f.gold) continue;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (golden) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n && i < arr.length; i++) {
        const f = arr[i];
        if (!f.gold) continue;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 3.2);
        g.addColorStop(0, 'rgba(255,230,160,0.95)');
        g.addColorStop(0.4, 'rgba(255,190,90,0.35)');
        g.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(f.x - f.r * 3.2, f.y - f.r * 3.2, f.r * 6.4, f.r * 6.4);
      }
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Sistema genérico (coordenadas en px CSS de pantalla)

export type ParticleKind = 'spark' | 'text' | 'steam' | 'mote';

export interface Particle {
  kind: ParticleKind;
  x: number; y: number;
  vx: number; vy: number;
  life: number; max: number;
  size: number;
  color: string;
  text?: string;
}

export class Particles {
  list: Particle[] = [];
  /** Movimiento reducido: menos chispas. */
  reduced = false;

  burst(x: number, y: number, n = 26, color = '#ffd98a') {
    if (this.reduced) n = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const sp = 60 + Math.random() * 140;
      this.list.push({
        kind: 'spark', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 0.8 + Math.random() * 0.7,
        size: 1.2 + Math.random() * 2.2,
        color: Math.random() < 0.3 ? '#fff4d6' : color,
      });
    }
  }

  text(x: number, y: number, text: string, color = '#ffd98a') {
    this.list.push({ kind: 'text', x, y, vx: 0, vy: -38, life: 0, max: 1.6, size: 15, color, text });
  }

  steam(x: number, y: number) {
    this.list.push({
      kind: 'steam', x: x + (Math.random() - 0.5) * 4, y,
      vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 8,
      life: 0, max: 2 + Math.random(), size: 2 + Math.random() * 2, color: '#ffffff',
    });
  }

  mote(x: number, y: number) {
    this.list.push({
      kind: 'mote', x, y,
      vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 4,
      life: 0, max: 3 + Math.random() * 3, size: 0.6 + Math.random() * 0.9, color: '#ffe9c2',
    });
  }

  count(kind: ParticleKind) {
    let n = 0;
    for (const p of this.list) if (p.kind === kind) n++;
    return n;
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'spark') { p.vy += 160 * dt; p.vx *= 1 - dt * 1.2; }
      if (p.kind === 'steam') { p.vx += Math.sin(p.life * 3) * 4 * dt; p.size += dt * 2.2; }
      if (p.kind === 'text') p.vy *= 1 - dt * 1.5;
      if (p.kind === 'mote') { p.vx += (Math.random() - 0.5) * 6 * dt; p.vy += (Math.random() - 0.5) * 6 * dt; }
    }
    this.list = this.list.filter((p) => p.life < p.max);
  }

  draw(ctx: CanvasRenderingContext2D, scale: number) {
    for (const p of this.list) {
      const k = 1 - p.life / p.max;
      if (p.kind === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const r = p.size * 2.6;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, rgba(p.color, k));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.restore();
      } else if (p.kind === 'text') {
        const a = Math.min(1, k * 2.2);
        ctx.font = `700 ${Math.round(p.size * Math.max(0.85, Math.min(1.3, scale)))}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(20,14,40,${(a * 0.8).toFixed(2)})`;
        ctx.strokeText(p.text!, p.x, p.y);
        ctx.fillStyle = rgba(p.color, a);
        ctx.fillText(p.text!, p.x, p.y);
      } else if (p.kind === 'steam') {
        ctx.fillStyle = `rgba(235,240,255,${(0.22 * k).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * scale * 0.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const a = Math.sin((p.life / p.max) * Math.PI) * 0.8;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}
