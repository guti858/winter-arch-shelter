// HUD superior (día, racha, nivel), dock de pilares, tooltip, toasts y avisos.
import type { App } from '../app';
import { OBJECT_DEFS, OBJECTS, type ObjectId } from '../game/state';
import { dayPriority, timerRemaining } from '../game/quests';
import { el, esc, fmtClock, pct } from './dom';

export class Hud {
  private bar: HTMLElement;
  private dock: HTMLElement;
  private tip: HTMLElement;
  private toasts: HTMLElement;
  private bannerEl: HTMLElement | null = null;

  constructor(root: HTMLElement, private app: App) {
    this.bar = el('header', 'hud');
    this.bar.setAttribute('role', 'banner');
    this.dock = el('nav', 'dock');
    this.dock.setAttribute('aria-label', 'Pilares y objetos de la habitación');
    this.tip = el('div', 'tooltip');
    this.tip.setAttribute('role', 'tooltip');
    this.toasts = el('div', 'toasts');
    this.toasts.setAttribute('aria-live', 'polite');
    root.append(this.bar, this.dock, this.tip, this.toasts);

    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'today') this.app.panel.toggle('today');
      if (a === 'journal') this.app.modals.journal();
      if (a === 'week') this.app.modals.summary();
      if (a === 'settings') this.app.modals.settings();
      if (a === 'timer') this.app.panel.open('desk');
      if (a === 'prio') this.app.panel.open('today');
    });
    this.dock.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-obj]');
      if (b) this.app.panel.toggle(b.dataset.obj as ObjectId);
    });
  }

  render() {
    const { app } = this;
    const s = app.state, d = app.derived;
    if (!s || !d) {
      this.bar.innerHTML = '';
      this.dock.innerHTML = '';
      this.dock.style.display = 'none';
      return;
    }
    this.dock.style.display = '';
    const { arc, level, streak } = d;
    const dayLabel = arc.status === 'pre'
      ? `<b>Calentamiento</b> <span class="phase">· empieza en ${arc.daysUntilStart} día${arc.daysUntilStart === 1 ? '' : 's'}</span>`
      : arc.status === 'post'
        ? `<b>Arco completado</b> <span class="phase">· ${arc.total}/${arc.total}</span>`
        : `<b>Día <span class="num">${arc.day}/${arc.total}</span></b> <span class="phase" title="Fase ${arc.phase}">· ${esc(arc.phaseName)}</span>`;
    const xpTxt = level.to === null ? `${s.xp} XP · máximo` : `${s.xp} / ${level.to} XP`;
    this.bar.innerHTML = `
      <div class="hud-chip hud-day" title="Arco: ${esc(s.arc.start)} → ${esc(s.arc.end)}">❄ ${dayLabel}</div>
      <div class="hud-chip hud-streak" title="Racha de días con el mínimo cumplido · tokens de descanso">
        <span class="flame" aria-hidden="true">🔥</span><span class="sr-only">Racha</span><b class="num">${streak}</b>
        <span class="tokens" title="Tokens de descanso">❄️<span class="sr-only">Tokens de descanso:</span><span class="num">${s.restTokens}</span></span>
      </div>
      <div class="hud-chip hud-level" title="Nivel de habitación">
        <span class="lvl">Nivel ${level.level}</span>
        <span class="xpbar" role="progressbar" aria-label="Experiencia" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(level.pct * 100)}"><i style="--pct:${pct(level.pct)}"></i></span>
        <span class="xp num">${xpTxt}</span>
      </div>
      ${this.priorityChip()}
      <div class="hud-chip hud-timer" data-hud-timer hidden></div>
      <div class="hud-spacer"></div>
      <div class="hud-actions">
        <button class="btn-ghost" data-action="today" aria-label="Ver todas las tareas de hoy"><span class="ico">☰</span><span>Hoy</span></button>
        <button class="btn-ghost" data-action="journal" aria-label="Diario nocturno"><span class="ico">✍️</span><span class="lbl-long">Diario</span></button>
        <button class="btn-ghost" data-action="week" aria-label="Resumen semanal"><span class="ico">📅</span><span class="lbl-long">Semana</span></button>
        <button class="btn-ghost" data-action="settings" aria-label="Ajustes"><span class="ico">⚙️</span><span class="lbl-long">Ajustes</span></button>
      </div>`;
    this.updateTimer();

    const current = app.panel.current;
    this.dock.innerHTML = OBJECTS.map((o) => {
      const def = OBJECT_DEFS[o];
      const p = app.objectProgress(o);
      const g = d.objects[o];
      const full = p.total > 0 && p.done >= p.total;
      return `<button data-obj="${o}" class="${current === o ? 'active' : ''}" aria-label="${esc(def.hint)}: ${p.done} de ${p.total}" aria-pressed="${current === o}">
        <span class="glow" style="--g:${(0.12 + g * 0.88).toFixed(2)}"></span>
        <span aria-hidden="true">${def.icon}</span>${esc(def.short)}
        ${p.total ? `<span class="count ${full ? 'full' : ''}">${p.done}/${p.total}</span>` : ''}
      </button>`;
    }).join('');
  }

  /** Prioridad del día (de la "prioridad de mañana" del diario de anoche). */
  private priorityChip(): string {
    const s = this.app.state;
    if (!s) return '';
    const p = dayPriority(s, this.app.today);
    if (!p) return '';
    const done = !!s.log[this.app.today]?.priorityDone;
    return `<button class="hud-chip hud-prio ${done ? 'done' : ''}" data-action="prio" title="Prioridad de hoy: ${esc(p)}" aria-label="Prioridad de hoy: ${esc(p)}${done ? ' (cumplida)' : ''}">🎯 <span>${esc(p)}</span>${done ? ' ✓' : ''}</button>`;
  }

  updateTimer() {
    const s = this.app.state;
    const box = this.bar.querySelector<HTMLElement>('[data-hud-timer]');
    if (!box) return;
    const t = s?.meta.timer;
    if (!s || !t) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const ms = timerRemaining(s, this.app.now());
    const label = `${t.kind === 'break' ? '☕' : '⏱'} ${fmtClock(ms)}${t.endsAt === null ? ' ⏸' : ''}`;
    if (box.dataset.label !== label) {
      box.dataset.label = label;
      box.innerHTML = `<button class="btn-ghost" data-action="timer" style="padding:0;border:0;background:none" aria-label="Temporizador">${label}</button>`;
    }
  }

  tooltip(target: ObjectId | null, x: number, y: number) {
    if (!target) {
      this.tip.classList.remove('show');
      return;
    }
    const def = OBJECT_DEFS[target];
    const p = this.app.objectProgress(target);
    const sub = target === 'window'
      ? (p.done ? 'diario escrito hoy' : 'diario nocturno')
      : p.total ? `${p.done}/${p.total} ${target === 'corkboard' ? 'metas' : 'hoy'}` : '';
    this.tip.innerHTML = `<b>${def.icon} ${esc(def.hint)}</b>${sub ? ` <span class="sub">· ${esc(sub)}</span>` : ''}`;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
    this.tip.classList.add('show');
  }

  /** Tooltip con HTML ya escapado (plantas del edificio). */
  tooltipHtml(html: string, x: number, y: number) {
    this.tip.innerHTML = html;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
    this.tip.classList.add('show');
  }

  toast(html: string, kind: '' | 'big' | 'ice' = '', ms = 4200) {
    const t = el('div', `toast ${kind}`, html);
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 450);
    }, ms);
  }

  banner(text: string) {
    if (this.bannerEl) return;
    this.bannerEl = el('div', 'banner', esc(text));
    this.bannerEl.setAttribute('role', 'alert');
    this.bar.parentElement!.append(this.bannerEl);
    setTimeout(() => this.bannerEl?.remove(), 12000);
  }

  phaseCard(kicker: string, title: string, body: string) {
    const card = el('div', 'phase-card', `<div role="status"><small>${esc(kicker)}</small><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`);
    this.bar.parentElement!.append(card);
    setTimeout(() => card.remove(), 5200);
  }
}
