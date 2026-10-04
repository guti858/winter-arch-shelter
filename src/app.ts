// Controlador: une el estado del juego (game/), la escena (engine/ + scene/) y la interfaz (ui/).
import { createInput, type PointerState } from './engine/input';
import { pick, Renderer } from './engine/renderer';
import type { SceneEnv } from './scene/objects';
import { addDays, arcInfo, logicalDate, weekStart, type ArcInfo } from './game/calendar';
import { allObjectMeters, allPillarMeters, LEVEL_UNLOCKS, levelFor, levelProgress, thresholds, type LevelProgress } from './game/progression';
import { activeQuests, bossDecor, isQuestDone, journalQuest, minimumStatus, tickTimer, type GameEvent, type MinimumStatus } from './game/quests';
import { computeStreak, settle, shouldAutoSummary, shouldShowReentry } from './game/streaks';
import { OBJECTS, PILLARS, questObject, type GameState, type ObjectId, type PillarId } from './game/state';
import type { Store } from './game/storage';
import { Hud } from './ui/hud';
import { Panel, type PanelTarget } from './ui/panel';
import { Modals } from './ui/modals';
import { Sfx } from './engine/audio';

export interface Derived {
  arc: ArcInfo;
  level: LevelProgress;
  streak: number;
  minimum: MinimumStatus;
  pillars: Record<PillarId, number>;
  objects: Record<ObjectId, number>;
}

export interface ObjectProgress { done: number; total: number }

export class App {
  state: GameState | null = null;
  today = '';
  derived: Derived | null = null;
  readonly renderer: Renderer;
  readonly hud: Hud;
  readonly panel: Panel;
  readonly modals: Modals;
  readonly sfx = new Sfx();
  hovered: ObjectId | null = null;
  /** Desfase del reloj (consola de depuración: __debug.setDay). */
  private timeOffset = 0;
  private pointer: PointerState;
  private last = performance.now();
  private tickAcc = 0;
  private env: SceneEnv;
  private systemReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(private canvas: HTMLCanvasElement, root: HTMLElement, readonly store: Store) {
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(root, this);
    this.panel = new Panel(root, this);
    this.modals = new Modals(root, this);
    this.env = this.emptyEnv();
    this.pointer = createInput(canvas, {
      onMove: (s) => this.onPointerMove(s),
      onTap: (s) => this.onTap(s),
    });
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.renderer.setRightInset(this.panel.current ? this.panel.el.offsetWidth + 12 : 0);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.modals.isOpen()) this.modals.close();
        else this.panel.close();
      }
    });
    window.addEventListener('pointerdown', () => this.sfx.unlock(this.state?.settings.sound ?? true), { once: true });
    window.addEventListener('keydown', () => this.sfx.unlock(this.state?.settings.sound ?? true), { once: true });
    window.addEventListener('beforeunload', () => this.store.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.store.flush();
      else this.checkDay();
    });
  }

  // ------------------------------------------------------------------ reloj

  now(): number {
    return Date.now() + this.timeOffset;
  }

  computeToday(): string {
    return logicalDate(new Date(this.now()));
  }

  /** Mueve el reloj para que hoy sea el día N del arco (depuración). */
  setDay(n: number) {
    if (!this.state) return;
    const target = addDays(this.state.arc.start, Math.round(n) - 1);
    const [y, m, d] = target.split('-').map(Number);
    this.timeOffset = new Date(y, m - 1, d, 12, 0, 0).getTime() - Date.now();
    this.checkDay(true);
  }

  resetClock() {
    this.timeOffset = 0;
    this.checkDay(true);
  }

  // ------------------------------------------------------------------ ciclo

  start() {
    this.today = this.computeToday();
    this.state = this.store.load();
    if (!this.store.available) this.hud.banner('No se puede guardar en este navegador (¿modo privado?). El juego funciona, pero el progreso se perderá al cerrar. Exporta tus datos desde Ajustes.');
    if (this.state) {
      this.applyReducedMotionClass();
      this.recompute();
      this.checkDay(true);
    } else {
      this.recompute();
      this.modals.onboarding();
    }
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Crea la partida al terminar la pantalla de inicio. */
  begin(state: GameState) {
    this.state = state;
    this.state.meta.lastPhaseSeen = arcInfo(state.arc, this.today).phase;
    this.applyReducedMotionClass();
    this.save();
    this.recompute();
    this.render();
    const info = this.derived!.arc;
    this.hud.phaseCard(info.status === 'pre' ? 'Calentamiento' : `Fase ${info.phase}`, info.status === 'pre' ? `El arco empieza el ${state.arc.start.split('-').reverse().slice(0, 2).join('/')}` : info.phaseName, 'Haz clic en los objetos de tu habitación para ver tus tareas.');
    this.renderer.particles.burst(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 40);
  }

  private loop(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.env.t = t / 1000;
    for (const k of Object.keys(this.env.flash) as ObjectId[]) {
      const v = Math.max(0, (this.env.flash[k] ?? 0) - dt * 0.7);
      if (v <= 0) delete this.env.flash[k];
      else this.env.flash[k] = v;
    }
    if (this.renderer.sweep !== null) {
      this.renderer.sweep += dt / 1.6;
      if (this.renderer.sweep >= 1) this.renderer.sweep = null;
    }
    this.tickAcc += dt;
    if (this.tickAcc >= 0.25) {
      this.tickAcc = 0;
      this.tick();
    }
    this.renderer.frame(this.env, dt, this.pointer, this.modals.isOpen() ? null : this.hovered);
    requestAnimationFrame((n) => this.loop(n));
  }

  /** 4 veces por segundo: temporizadores, cambio de día. */
  private tick() {
    if (!this.state) return;
    const ev = tickTimer(this.state, this.now(), this.today);
    if (ev.length) {
      this.handleEvents(ev, 'desk');
      this.afterChange();
    }
    this.panel.updateTimers();
    this.hud.updateTimer();
    if (this.computeToday() !== this.today) this.checkDay();
  }

  /** Cambio de día lógico (o arranque): cierra días pasados, mensajes de reentrada, fase y resumen. */
  checkDay(force = false) {
    if (!this.state) return;
    const today = this.computeToday();
    if (!force && today === this.today) return;
    this.today = today;
    const res = settle(this.state, today);
    if (res.tokensEarned) this.hud.toast(`❄️ Semana sólida: ganas ${res.tokensEarned > 1 ? res.tokensEarned + ' tokens' : 'un token'} de descanso.`, 'ice');
    if (res.tokensUsedOn.length) this.hud.toast(`❄️ Un token de descanso salvó tu racha (${res.tokensUsedOn.length} día${res.tokensUsedOn.length > 1 ? 's' : ''}).`, 'ice');
    this.recompute();
    this.checkPhase();
    this.checkLevel(false);
    if (shouldShowReentry(this.state, today)) {
      this.state.meta.reentryShown = today;
      this.modals.enqueue(() => this.modals.message('Hola de nuevo', 'Cuenta como día 1. La habitación sigue como la dejaste.', '❄️'));
    }
    if (shouldAutoSummary(this.state, today)) {
      this.state.meta.lastSummaryWeek = weekStart(today);
      this.modals.enqueue(() => this.modals.summary());
    }
    this.save();
    this.render();
  }

  // ------------------------------------------------------------------ acciones

  /** Aplica una mutación de juego y procesa sus eventos. */
  act(fn: (s: GameState, today: string) => GameEvent[] | void, origin?: ObjectId) {
    if (!this.state) return;
    const ev = fn(this.state, this.today) || [];
    this.handleEvents(ev, origin);
    this.afterChange();
  }

  afterChange() {
    this.save();
    this.recompute();
    this.checkLevel(true);
    this.render();
  }

  save() {
    if (this.state) this.store.save(this.state);
  }

  private handleEvents(events: GameEvent[], origin?: ObjectId) {
    let textOffset = 0;
    for (const e of events) {
      const obj = ('object' in e && e.object) || origin;
      const at = obj ? this.renderer.anchorOf(obj) : ([this.canvas.clientWidth / 2, this.canvas.clientHeight / 2] as [number, number]);
      switch (e.type) {
        case 'complete':
          this.renderer.particles.burst(at[0], at[1], 28);
          this.env.flash[e.object] = 1;
          this.sfx.play('pop');
          break;
        case 'xp':
          if (e.amount === 0) break;
          this.renderer.particles.text(at[0], at[1] - 14 - textOffset, `${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount)} XP`, e.amount > 0 ? '#ffd98a' : '#9aa3c8');
          textOffset += 20;
          break;
        case 'minimum':
          this.hud.toast('✓ <b>Día mínimo cumplido.</b> La racha sigue viva.');
          this.sfx.play('chime');
          break;
        case 'allDone':
          this.hud.toast(`<strong>¡Todas las diarias!</strong>Bonus de +${e.amount} XP`, 'big');
          for (const o of OBJECTS) this.env.flash[o] = 0.6;
          this.sfx.play('chime');
          break;
        case 'goal':
          if (e.done) {
            this.renderer.particles.burst(at[0], at[1], 40);
            this.env.flash.corkboard = 1;
            this.hud.toast('📌 <b>Meta del arco cumplida.</b> Eso es enorme.', 'big');
            this.sfx.play('chime');
          }
          break;
        case 'timerDone':
          if (e.kind === 'work') this.hud.toast(e.questId?.includes('pomodoro') ? '⏱ Bloque completado. Descanso de 5 minutos.' : '⏱ Tiempo cumplido.');
          else this.hud.toast('☕ Fin del descanso. ¿Otro bloque?', 'ice');
          this.sfx.play('bell');
          break;
        case 'uncomplete':
          break;
      }
    }
  }

  private checkLevel(celebrate: boolean) {
    if (!this.state) return;
    const lvl = levelFor(this.state.xp, this.state.arc.intensity);
    const seen = this.state.meta.lastLevelSeen;
    if (lvl > seen) {
      this.state.meta.lastLevelSeen = lvl;
      if (celebrate) {
        this.renderer.sweep = 0;
        this.hud.toast(`<strong>Nivel de habitación ${lvl}</strong>${LEVEL_UNLOCKS[lvl]}`, 'big');
        this.sfx.play('levelup');
      }
      this.save();
    } else if (lvl < seen) {
      this.state.meta.lastLevelSeen = lvl;
    }
  }

  private checkPhase() {
    if (!this.state || !this.derived) return;
    const { phase, phaseName, status } = this.derived.arc;
    if (status !== 'pre' && phase > this.state.meta.lastPhaseSeen) {
      this.state.meta.lastPhaseSeen = phase;
      const focus = phase === 2 ? 'Sube la carga: nuevas tareas y retos semanales.' : 'Consolida lo construido y cierra tus metas.';
      this.hud.phaseCard(`Fase ${phase}`, phaseName, focus);
      this.renderer.sweep = 0;
      this.sfx.play('levelup');
    }
  }

  // ------------------------------------------------------------------ derivados

  recompute() {
    const s = this.state;
    if (!s) {
      this.derived = null;
      this.env = this.emptyEnv();
      return;
    }
    const today = this.today;
    const arc = arcInfo(s.arc, today);
    const objects = allObjectMeters(s, today);
    this.derived = {
      arc,
      level: levelProgress(s.xp, s.arc.intensity),
      streak: computeStreak(s, today),
      minimum: minimumStatus(s, today),
      pillars: allPillarMeters(s, today),
      objects,
    };
    const jq = journalQuest(s);
    const t = this.env.t;
    const flash = this.env.flash;
    this.env = {
      level: this.derived.level.level,
      phase: arc.phase,
      t,
      meters: this.derived.pillars,
      glow: objects,
      flash,
      goals: s.goals.map((g) => ({ text: g.text, done: g.done })),
      bossDecor: bossDecor(s, today),
      timerRunning: !!s.meta.timer && s.meta.timer.kind === 'work',
      journalToday: !!jq && isQuestDone(s, jq, today),
      reducedMotion: this.reducedMotion,
    };
  }

  get reducedMotion(): boolean {
    return this.systemReducedMotion || !!this.state?.settings.reducedMotion;
  }

  applyReducedMotionClass() {
    document.documentElement.classList.toggle('reduced-motion', this.reducedMotion);
  }

  private emptyEnv(): SceneEnv {
    const zeroP = Object.fromEntries(PILLARS.map((p) => [p, 0])) as Record<PillarId, number>;
    const zeroO = Object.fromEntries(OBJECTS.map((o) => [o, 0])) as Record<ObjectId, number>;
    return {
      level: 1, phase: 1, t: this.env?.t ?? 0, meters: zeroP, glow: zeroO, flash: {}, goals: [],
      bossDecor: null, timerRunning: false, journalToday: false, reducedMotion: this.systemReducedMotion,
    };
  }

  /** Progreso de hoy de un objeto (para tooltip y dock). */
  objectProgress(obj: ObjectId): ObjectProgress {
    const s = this.state;
    if (!s) return { done: 0, total: 0 };
    if (obj === 'corkboard') {
      const goals = s.goals.length;
      const boss = activeQuests(s, this.today).filter((q) => questObject(q) === 'corkboard');
      return {
        done: s.goals.filter((g) => g.done).length + boss.filter((q) => isQuestDone(s, q, this.today)).length,
        total: goals + boss.length,
      };
    }
    const qs = activeQuests(s, this.today).filter((q) => questObject(q) === obj && q.kind !== 'milestone');
    return { done: qs.filter((q) => isQuestDone(s, q, this.today)).length, total: qs.length };
  }

  render() {
    this.hud.render();
    this.panel.render();
  }

  // ------------------------------------------------------------------ escena

  private onPointerMove(s: PointerState) {
    const target = s.inside && this.state && !this.modals.isOpen() ? pick(this.renderer.view, this.env, s.x, s.y) : null;
    if (target !== this.hovered) {
      this.hovered = target;
      this.canvas.style.cursor = target ? 'pointer' : 'default';
    }
    this.hud.tooltip(target, s.x, s.y);
  }

  private onTap(s: PointerState) {
    if (!this.state || this.modals.isOpen()) return;
    const target = pick(this.renderer.view, this.env, s.x, s.y);
    if (target) this.openObject(target);
    else if (this.panel.current) this.panel.close();
  }

  openObject(target: PanelTarget) {
    if (this.state) this.panel.open(target);
  }

  /** Destello cálido sobre un objeto (p. ej. la ventana al guardar el diario). */
  flash(obj: ObjectId, amount = 1) {
    this.env.flash[obj] = Math.max(this.env.flash[obj] ?? 0, amount);
  }

  // ------------------------------------------------------------------ depuración

  installDebug() {
    const app = this;
    const debug = {
      /** Suma XP para probar niveles. */
      addXp(n: number): string {
        if (!app.state) return 'Primero completa la pantalla de inicio.';
        app.state.xp = Math.max(0, app.state.xp + n);
        app.state.meta.debugXp = (app.state.meta.debugXp ?? 0) + n;
        app.afterChange();
        return `XP ${app.state.xp} · nivel ${levelFor(app.state.xp, app.state.arc.intensity)}`;
      },
      /** Fija el nivel de habitación (ajusta el XP al umbral). */
      setLevel(n: number) {
        if (!app.state) return;
        const th = thresholds(app.state.arc.intensity);
        const lvl = Math.max(1, Math.min(10, Math.round(n)));
        return debug.addXp(th[lvl - 1] - app.state.xp);
      },
      /** Viaja al día N del arco (1..88) sin esperar días reales. */
      setDay(n: number) {
        app.setDay(n);
        return `Hoy: ${app.today} · ${app.derived ? `día ${app.derived.arc.day} · fase ${app.derived.arc.phase}` : ''}`;
      },
      /** Vuelve a la fecha real. */
      resetDay() {
        app.resetClock();
        return `Hoy: ${app.today}`;
      },
      today: () => app.today,
      state: () => app.state,
      help: () => 'addXp(n) · setLevel(n) · setDay(n) · resetDay() · today() · state()',
    };
    (window as unknown as { __debug: typeof debug }).__debug = debug;
  }
}
