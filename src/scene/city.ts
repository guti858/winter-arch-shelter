// Skyline procedural con semilla fija: cielo, luna, estrellas, 3 capas de edificios
// con ventanas (algunas parpadean), balizas rojas, avenida con coches y tren elevado.
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
  {
    color: '#0b0e26', edge: '#1a1f45', minH: 0.08, maxH: 0.27, minW: 60, maxW: 140, gap: 14,
    win: { w: 4, h: 5, sx: 10, sy: 12, lit: 0.36, alpha: [0.7, 1] }, parallax: 10, haze: 'rgba(0,0,0,0)',
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

interface Car { x: number; speed: number; dir: 1 | -1; lane: number }

export class City {
  private w = 0;
  private h = 0;
  private dpr = 1;
  private layers: BuiltLayer[] = [];
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private sky: HTMLCanvasElement = document.createElement('canvas');
  private cars: Car[] = [];
  private trainX = -2000;
  private trainNext = 6;
  private bakedGlow = -1;

  constructor(private seed = 2026) {}

  get avenueY() { return this.h * 0.8; }
  get trackY() { return this.h * 0.69; }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    const rnd = mulberry32(this.seed);
    this.buildSky(rnd);
    this.layers = LAYERS.map((spec, i) => this.buildLayer(spec, mulberry32(this.seed + i * 101)));
    this.bakedGlow = -1;
    const crand = mulberry32(this.seed + 7);
    this.cars = Array.from({ length: 16 }, (_, i) => ({
      x: crand() * w,
      speed: 28 + crand() * 40,
      dir: (i % 2 ? 1 : -1) as 1 | -1,
      lane: i % 2,
    }));
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
    for (const c of this.cars) {
      c.x += c.speed * c.dir * dt;
      if (c.dir > 0 && c.x > this.w + 20) c.x = -20;
      if (c.dir < 0 && c.x < -20) c.x = this.w + 20;
    }
    this.trainNext -= dt;
    if (this.trainNext <= 0 && this.trainX < -1000) this.trainX = this.w + 40;
    if (this.trainX > -1000) {
      this.trainX -= 70 * dt;
      if (this.trainX < -260) { this.trainX = -2000; this.trainNext = 25 + Math.random() * 20; }
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
      if (i === 1) this.drawTrain(ctx, dx, dy, glow);
      if (i === 2) this.drawAvenue(ctx, dx, dy, t, glow);
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
    // bruma baja sobre la ciudad; su tono respira muy despacio (la ciudad "vive")
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.05) * Math.sin(t * 0.021 + 1);
    const fog = ctx.createLinearGradient(0, h * 0.72, 0, h);
    fog.addColorStop(0, 'rgba(40,30,80,0)');
    fog.addColorStop(1, `rgba(${Math.round(30 + 40 * breathe)},${Math.round(22 + 10 * breathe)},${Math.round(60 - 10 * breathe)},0.35)`);
    ctx.fillStyle = fog;
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
  }

  private drawAvenue(ctx: CanvasRenderingContext2D, dx: number, dy: number, t: number, glow: number) {
    const y = this.avenueY + dy;
    ctx.fillStyle = '#0d1030';
    ctx.fillRect(0, y - 3, this.w, 9);
    // farolas de sodio
    for (let x = (dx % 46) + 46; x < this.w; x += 46) {
      const g = ctx.createRadialGradient(x, y - 3, 0, x, y - 3, 12);
      g.addColorStop(0, `rgba(255,170,80,${0.55 * glow})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 12, y - 15, 24, 24);
    }
    for (const c of this.cars) {
      const cy = y + (c.lane ? 3.5 : 0.5);
      const x = c.x + dx * 0.3;
      if (c.dir > 0) {
        ctx.fillStyle = 'rgba(255,250,230,0.95)';
        ctx.fillRect(x, cy, 2.2, 1.6);
        const g = ctx.createLinearGradient(x + 2, 0, x + 18, 0);
        g.addColorStop(0, 'rgba(255,245,220,0.35)');
        g.addColorStop(1, 'rgba(255,245,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + 2, cy - 0.5, 16, 2.6);
      } else {
        ctx.fillStyle = `rgba(255,60,60,${0.75 + 0.25 * Math.sin(t * 5 + c.speed)})`;
        ctx.fillRect(x, cy, 2.2, 1.6);
      }
    }
  }

  private drawTrain(ctx: CanvasRenderingContext2D, dx: number, dy: number, glow: number) {
    const y = this.trackY + dy;
    ctx.fillStyle = '#121638';
    ctx.fillRect(0, y + 7, this.w, 3);
    for (let x = (dx % 70); x < this.w; x += 70) ctx.fillRect(x, y + 10, 3, this.h - y);
    if (this.trainX < -1000) return;
    for (let car = 0; car < 4; car++) {
      const x = this.trainX + car * 58;
      ctx.fillStyle = '#1b2150';
      ctx.fillRect(x, y - 2, 54, 9);
      ctx.fillStyle = `rgba(255,230,170,${0.85 * glow})`;
      for (let k = 0; k < 7; k++) ctx.fillRect(x + 4 + k * 7, y, 4, 3);
    }
    const hx = this.trainX - 2;
    const g = ctx.createLinearGradient(hx, 0, hx - 40, 0);
    g.addColorStop(0, 'rgba(255,255,230,0.5)');
    g.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(hx - 40, y, 40, 4);
  }
}
