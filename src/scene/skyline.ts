// Fondo lejano en 2D: cielo, luna, estrellas y dos capas de skyline con bruma.
// Hace de horizonte detrás de la ciudad isométrica (que está en city.ts).
import { mulberry32 } from '../engine/random';
import { rgba } from '../engine/color';

interface Win { x: number; y: number; w: number; h: number; color: string; on: boolean; next: number }
interface Beacon { x: number; y: number; phase: number }

interface LayerSpec {
  color: string; // silueta
  edge: string; // borde superior iluminado
  minH: number; maxH: number; // fracción de la altura de pantalla
  minW: number; maxW: number;
  gap: number;
  win: { w: number; h: number; sx: number; sy: number; lit: number; alpha: [number, number] };
  parallax: number;
  haze: string; // velo atmosférico sobre la capa
}

const LAYERS: LayerSpec[] = [
  {
    color: '#1d2452', edge: '#2c3570', minH: 0.3, maxH: 0.62, minW: 26, maxW: 64, gap: 2,
    win: { w: 2, h: 2, sx: 5, sy: 6, lit: 0.33, alpha: [0.35, 0.7] }, parallax: 2, haze: 'rgba(60,50,110,0.35)',
  },
  {
    color: '#151a3e', edge: '#232a5c', minH: 0.2, maxH: 0.46, minW: 38, maxW: 92, gap: 6,
    win: { w: 3, h: 3, sx: 7, sy: 8, lit: 0.35, alpha: [0.55, 0.9] }, parallax: 5, haze: 'rgba(40,30,80,0.22)',
  },
];

const WARM = ['#ffd98a', '#ffe7b0', '#ffc46b', '#ffb347', '#fff1cf'];
const COOL = ['#cfe6ff', '#a9d4ff'];
const MARGIN = 16;

interface BuiltLayer {
  body: HTMLCanvasElement;
  windows: HTMLCanvasElement;
  /** body + ventanas con el brillo actual (se regenera solo si cambia el brillo). */
  composite: HTMLCanvasElement;
  flicker: Win[];
  beacons: Beacon[];
}

export class Skyline {
  private w = 0;
  private h = 0;
  private dpr = 1;
  private layers: BuiltLayer[] = [];
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private sky: HTMLCanvasElement = document.createElement('canvas');
  private bakedGlow = -1;

  constructor(private seed = 2026) {}

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    const rnd = mulberry32(this.seed);
    this.buildSky(rnd);
    this.layers = LAYERS.map((spec, i) => this.buildLayer(spec, mulberry32(this.seed + i * 101)));
    this.bakedGlow = -1;
  }

  private canvas(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * this.dpr);
    c.height = Math.ceil(h * this.dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { c, ctx };
  }

  private buildSky(rnd: () => number) {
    const { w, h } = this;
    const { c, ctx } = this.canvas(w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#070a1c');
    g.addColorStop(0.35, '#0b1026');
    g.addColorStop(0.62, '#1b1740');
    g.addColorStop(0.82, '#2c1f4e');
    g.addColorStop(1, '#3a2450');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // contaminación lumínica cálida en el horizonte
    const hz = ctx.createRadialGradient(w * 0.5, h * 1.05, 10, w * 0.5, h * 1.05, Math.max(w, h) * 0.75);
    hz.addColorStop(0, 'rgba(255,150,90,0.22)');
    hz.addColorStop(0.5, 'rgba(160,80,140,0.10)');
    hz.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, w, h);
    // luna
    const mx = w * 0.14, my = h * 0.17, mr = Math.max(14, Math.min(w, h) * 0.03);
    const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 7);
    halo.addColorStop(0, 'rgba(220,225,255,0.22)');
    halo.addColorStop(1, 'rgba(220,225,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
    ctx.fillStyle = '#f1f0e6';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,180,170,0.35)';
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [0.05, 0.45, 0.12], [-0.4, 0.3, 0.09]]) {
      ctx.beginPath();
      ctx.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2);
      ctx.fill();
    }
    this.sky = c;
    const stars = Array.from({ length: Math.round((w * h) / 5200) }, () => ({
      x: rnd() * w,
      y: Math.pow(rnd(), 1.6) * h * 0.62,
      r: rnd() < 0.08 ? 1.3 : 0.4 + rnd() * 0.6,
      tw: rnd() < 0.3 ? rnd() * Math.PI * 2 : -1,
    }));
    // las estrellas fijas se hornean en el cielo; solo las que titilan se dibujan cada frame
    ctx.fillStyle = 'rgba(225,232,255,0.55)';
    for (const s of stars) if (s.tw < 0) ctx.fillRect(s.x, s.y, s.r, s.r);
    this.stars = stars.filter((s) => s.tw >= 0);
  }

  private buildLayer(spec: LayerSpec, rnd: () => number): BuiltLayer {
    const W = this.w + MARGIN * 2, H = this.h;
    const body = this.canvas(W, H);
    const wins = this.canvas(W, H);
    const flicker: Win[] = [];
    const beacons: Beacon[] = [];
    let x = -rnd() * 30;
    while (x < W) {
      const bw = spec.minW + rnd() * (spec.maxW - spec.minW);
      const bh = H * (spec.minH + Math.pow(rnd(), 1.3) * (spec.maxH - spec.minH));
      const top = H - bh;
      body.ctx.fillStyle = spec.color;
      body.ctx.fillRect(x, top, bw, bh);
      // remates: escalonado, antena o depósito
      const r = rnd();
      if (r < 0.25) {
        const sw = bw * (0.4 + rnd() * 0.3), sh = 8 + rnd() * 26;
        body.ctx.fillRect(x + (bw - sw) / 2, top - sh, sw, sh);
        if (rnd() < 0.6) {
          const ax = x + bw / 2, ah = 10 + rnd() * 30;
          body.ctx.fillRect(ax - 0.75, top - sh - ah, 1.5, ah);
          beacons.push({ x: ax, y: top - sh - ah, phase: rnd() * Math.PI * 2 });
        }
      } else if (r < 0.4) {
        body.ctx.fillRect(x + bw * 0.6, top - 7, bw * 0.22, 7); // depósito de agua
      } else if (r < 0.5) {
        body.ctx.beginPath(); // tejado inclinado
        body.ctx.moveTo(x, top);
        body.ctx.lineTo(x + bw, top);
        body.ctx.lineTo(x + bw * (rnd() < 0.5 ? 0.15 : 0.85), top - 14 - rnd() * 18);
        body.ctx.closePath();
        body.ctx.fill();
      }
      // filo superior con nieve/luz
      body.ctx.fillStyle = spec.edge;
      body.ctx.fillRect(x, top, bw, 1.5);
      // ventanas
      const { w: ww, h: wh, sx, sy, lit, alpha } = spec.win;
      const cols = Math.floor((bw - 6) / sx);
      const rows = Math.floor((bh - 8) / sy);
      const ox = x + (bw - cols * sx) / 2 + (sx - ww) / 2;
      const litBias = rnd() * 0.3 - 0.15; // cada edificio con su carácter
      for (let cy = 0; cy < rows; cy++) {
        const rowOff = rnd() < 0.08; // plantas enteras apagadas
        for (let cx = 0; cx < cols; cx++) {
          const wx = ox + cx * sx, wy = top + 6 + cy * sy;
          const on = !rowOff && rnd() < lit + litBias;
          const color = rnd() < 0.82 ? WARM[Math.floor(rnd() * WARM.length)] : COOL[Math.floor(rnd() * COOL.length)];
          const a = alpha[0] + rnd() * (alpha[1] - alpha[0]);
          if (rnd() < 0.035) {
            flicker.push({ x: wx, y: wy, w: ww, h: wh, color: rgba(color, a), on, next: 2 + rnd() * 38 });
            continue;
          }
          if (on) {
            wins.ctx.fillStyle = rgba(color, a);
            wins.ctx.fillRect(wx, wy, ww, wh);
          } else if (rnd() < 0.25) {
            wins.ctx.fillStyle = 'rgba(120,140,220,0.06)';
            wins.ctx.fillRect(wx, wy, ww, wh);
          }
        }
      }
      x += bw + rnd() * spec.gap;
    }
    // velo atmosférico (las capas lejanas se funden con el cielo)
    if (spec.haze !== 'rgba(0,0,0,0)') {
      body.ctx.globalCompositeOperation = 'source-atop';
      const g = body.ctx.createLinearGradient(0, H * 0.3, 0, H);
      g.addColorStop(0, spec.haze);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      body.ctx.fillStyle = g;
      body.ctx.fillRect(0, 0, W, H);
      body.ctx.globalCompositeOperation = 'source-over';
    }
    const composite = this.canvas(W, H).c;
    return { body: body.c, windows: wins.c, composite, flicker, beacons };
  }

  update(dt: number) {
    for (const L of this.layers) {
      for (const f of L.flicker) {
        f.next -= dt;
        if (f.next <= 0) {
          f.on = !f.on;
          f.next = 10 + Math.random() * 30; // apagado/encendido cada 10–40 s
        }
      }
    }
  }

  /** Compone silueta + ventanas con el brillo dado (solo cuando cambia: al subir de nivel). */
  private bake(glow: number) {
    for (const L of this.layers) {
      const ctx = L.composite.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, L.composite.width, L.composite.height);
      ctx.drawImage(L.body, 0, 0);
      ctx.globalAlpha = Math.min(1, glow);
      ctx.drawImage(L.windows, 0, 0);
      if (glow > 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.5, glow - 1);
        ctx.drawImage(L.windows, 0, 0);
      }
    }
    this.bakedGlow = glow;
  }

  draw(ctx: CanvasRenderingContext2D, t: number, nx: number, ny: number, glow: number) {
    const { w, h } = this;
    if (Math.abs(glow - this.bakedGlow) > 0.005) this.bake(glow);
    ctx.drawImage(this.sky, 0, 0, w, h);
    // estrellas que titilan
    for (const s of this.stars) {
      const a = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.tw));
      ctx.fillStyle = `rgba(225,232,255,${a.toFixed(2)})`;
      ctx.fillRect(s.x - nx * 0.6, s.y - ny * 0.4, s.r, s.r);
    }
    this.layers.forEach((L, i) => {
      const spec = LAYERS[i];
      const dx = -MARGIN - nx * spec.parallax, dy = -ny * spec.parallax * 0.5;
      ctx.drawImage(L.composite, dx, dy, w + MARGIN * 2, h);
      for (const f of L.flicker) {
        if (!f.on) continue;
        ctx.fillStyle = f.color;
        ctx.fillRect(f.x + dx, f.y + dy, f.w, f.h);
      }
      for (const b of L.beacons) {
        const on = Math.sin(t * 2.2 + b.phase) > 0.55;
        if (!on) continue;
        const bx = b.x + dx, by = b.y + dy;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, 7);
        g.addColorStop(0, 'rgba(255,70,60,0.95)');
        g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx - 7, by - 7, 14, 14);
      }
    });
  }
}
