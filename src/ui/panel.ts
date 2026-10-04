// Panel lateral: tareas del objeto activo, vista plana de "hoy" (con periodo de gracia para ayer),
// diario, metas con sus pasos y prioridad del día.
import type { App } from '../app';
import { addDays, arcInfo, prettyDate } from '../game/calendar';
import {
  activeQuests, addGoal, bossChallenge, cancelTimer, dayPriority, findQuest, goalStepCount, goalSteppedOn,
  incrementQuest, journalQuest, openGoals, pauseTimer, questGoal, questProgress, resumeTimer, startTimer,
  timerRemaining, toggleGoal, toggleGoalStep, togglePriority, toggleQuest,
} from '../game/quests';
import { bestStreak, canEditDate, canUseReduced, setReducedMode, useRestToken } from '../game/streaks';
import {
  GOAL_XP, OBJECT_DEFS, PILLAR_DEFS, PRIORITY_XP, hasTag, pillarDef, questObject, questTitle,
  type GameState, type ObjectId, type Quest,
} from '../game/state';
import { el, esc, fmtClock, pct, renderKeepFocus } from './dom';

export type PanelTarget = ObjectId | 'today';

export class Panel {
  readonly el: HTMLElement;
  current: PanelTarget | null = null;
  /** Día que muestra la vista "Hoy": hoy o ayer (periodo de gracia). */
  private day: 'today' | 'yesterday' = 'today';
  private lastFocus: HTMLElement | null = null;

  constructor(root: HTMLElement, private app: App) {
    this.el = el('aside', 'panel');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.setAttribute('aria-labelledby', 'panel-title');
    root.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('submit', (e) => this.onSubmit(e));
  }

  open(target: PanelTarget, day: 'today' | 'yesterday' = 'today') {
    if (!this.app.state) return;
    if (!this.current) this.lastFocus = document.activeElement as HTMLElement | null;
    this.current = target;
    this.day = day;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.app.renderer.setRightInset(this.el.offsetWidth + 12);
    this.render();
    this.app.hud.render();
    requestAnimationFrame(() => (this.el.querySelector<HTMLElement>('.panel-body button:not([disabled]), .panel-body input') ?? this.el.querySelector<HTMLElement>('[data-action="close"]'))?.focus({ preventScroll: true }));
  }

  toggle(target: PanelTarget) {
    if (this.current === target) this.close();
    else this.open(target);
  }

  close() {
    if (!this.current) return;
    this.current = null;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.app.renderer.setRightInset(0);
    this.app.hud.render();
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  render() {
    const s = this.app.state;
    if (!s || !this.current) return;
    const html = this.current === 'today' ? this.renderToday(s) : this.renderObject(s, this.current);
    renderKeepFocus(this.el, html);
    this.updateTimers();
  }

  /** Fecha que se está editando en la vista actual. */
  private get date(): string {
    const today = this.app.today;
    if (this.current !== 'today' || this.day === 'today') return today;
    const y = addDays(today, -1);
    return this.app.state && canEditDate(this.app.state, y, today) ? y : today;
  }

  // ------------------------------------------------------------------ vistas

  private head(icon: string, title: string, sub: string, meter?: number) {
    return `<div class="panel-head">
      <div class="big" aria-hidden="true">${icon}</div>
      <div class="titles">
        <h2 id="panel-title">${esc(title)}</h2>
        <p>${esc(sub)}</p>
        ${meter !== undefined ? `<div class="meter" title="Medidor de luz del pilar (hoy y últimos 7 días)"><span>Luz</span><span class="bar"><i style="--pct:${pct(meter)}"></i></span><span class="num">${pct(meter)}</span></div>` : ''}
      </div>
      <button class="icon-btn" data-action="close" data-key="close" aria-label="Cerrar panel">✕</button>
    </div>`;
  }

  private foot(s: GameState, date = this.app.today) {
    const m = date === this.app.today ? this.app.derived!.minimum : null;
    const log = s.log[date];
    if (!m) {
      return `<div class="panel-foot"><span>⏳ Periodo de gracia: lo que marques aquí cuenta para <b>${esc(prettyDate(date, true))}</b>. Se cierra cuando acabe hoy.</span></div>`;
    }
    const pips = Array.from({ length: m.need }, (_, i) => `<i class="${i < m.done ? 'on' : ''}"></i>`).join('');
    return `<div class="panel-foot">
      <span>★ Día mínimo</span><span class="pips" aria-label="${Math.min(m.done, m.need)} de ${m.need}">${pips}</span>
      <span class="num">${Math.min(m.done, m.need)}/${m.need}</span>
      ${m.met ? '<span style="color:var(--ok)">✓ cumplido</span>' : log?.reducedMode ? '<span>· día malo activado</span>' : ''}
      ${log?.restDay ? '<span style="color:var(--ice)">· descanso planeado ❄️</span>' : ''}
    </div>`;
  }

  private renderObject(s: GameState, obj: ObjectId) {
    const def = OBJECT_DEFS[obj];
    const d = this.app.derived!;
    if (obj === 'window') return this.renderJournal(s);
    if (obj === 'corkboard') return this.renderGoals(s);
    const pdef = pillarDef(def.pillar);
    const phase = d.arc.phase;
    const today = this.app.today;
    const all = s.quests.filter((q) => q.active && questObject(q) === obj);
    const avail = activeQuests(s, today).filter((q) => questObject(q) === obj);
    const locked = all.filter((q) => phase < (q.phaseFrom ?? 1));
    const daily = avail.filter((q) => q.kind === 'daily');
    const weekly = avail.filter((q) => q.kind === 'weekly');
    const miles = avail.filter((q) => q.kind === 'milestone');
    let body = '';
    if (obj === 'desk') body += this.timerBlock(s);
    if (daily.length) body += `<div class="section-title">Hoy</div>` + daily.map((q) => this.row(s, q, today)).join('');
    if (weekly.length) body += `<div class="section-title">Esta semana</div>` + weekly.map((q) => this.row(s, q, today)).join('');
    if (miles.length) body += `<div class="section-title">Del arco</div>` + miles.map((q) => this.row(s, q, today)).join('');
    if (locked.length) body += `<div class="section-title">Próximamente</div>` + locked.map((q) => this.lockedRow(s, q)).join('');
    if (!all.length) body += `<div class="note">No tienes tareas activas aquí. Puedes activarlas en <b>Ajustes → Tareas</b>.</div>`;
    if (canEditDate(s, addDays(today, -1), today)) {
      body += `<div class="note">¿Se te olvidó marcar algo ayer? <button class="btn small" data-action="open-yesterday" data-key="open-y">Completar lo de ayer</button></div>`;
    }
    return this.head(def.icon, def.name, `${pdef.icon} ${pdef.name} · ${pdef.description}`, d.objects[obj])
      + `<div class="panel-body">${body}</div>` + this.foot(s);
  }

  private renderToday(s: GameState) {
    const today = this.app.today;
    const date = this.date;
    const isToday = date === today;
    const d = this.app.derived!;
    const log = s.log[date];
    const quests = activeQuests(s, date);
    const yesterday = addDays(today, -1);
    let body = '';
    if (canEditDate(s, yesterday, today)) {
      body += `<div class="seg" role="tablist" aria-label="Día">
        <button role="tab" data-action="day" data-day="today" data-key="day-today" aria-selected="${isToday}">Hoy</button>
        <button role="tab" data-action="day" data-day="yesterday" data-key="day-y" aria-selected="${!isToday}">Ayer · ${esc(prettyDate(yesterday, true))}</button>
      </div>`;
    }
    if (isToday) {
      body += this.priorityBlock(s);
      const reducedAllowed = canUseReduced(s, today);
      const tokenOk = s.restTokens > 0 && !log?.restDay && !d.minimum.met;
      body += `<div class="q-controls" style="margin:8px 4px 4px">
        <button class="btn small ${log?.reducedMode ? 'on' : ''}" data-action="reduced" data-key="reduced" ${!reducedAllowed && !log?.reducedMode ? 'disabled title="Ya usaste el día malo esta semana"' : ''} aria-pressed="${!!log?.reducedMode}">🌧 Día malo${log?.reducedMode ? ' (activo)' : ''}</button>
        <button class="btn small" data-action="rest" data-key="rest" ${tokenOk ? '' : 'disabled'} title="Gasta un token para planear un descanso hoy">❄️ Descanso (${s.restTokens})</button>
      </div>`;
      if (log?.reducedMode) body += `<div class="note"><b>Día malo:</b> hoy bastan 2 tareas ★ para mantener la racha (sin bonus). Mañana será otro día.</div>`;
    } else {
      body += `<div class="note"><b>Ayer:</b> marca lo que hiciste y no apuntaste. Si completas el mínimo y un token había salvado ese día, lo recuperas.</div>`;
    }
    for (const pdef of PILLAR_DEFS) {
      const qs = quests.filter((q) => q.pillar === pdef.id && q.kind === 'daily');
      if (!qs.length) continue;
      body += `<div class="section-title">${pdef.icon} ${esc(pdef.name)}</div>` + qs.map((q) => this.row(s, q, date)).join('');
    }
    const weekly = quests.filter((q) => q.kind === 'weekly');
    if (weekly.length) body += `<div class="section-title">📅 ${isToday ? 'Esta semana' : 'Semana de ayer'}</div>` + weekly.map((q) => this.row(s, q, date)).join('');
    const { arc } = d;
    const sub = arc.status === 'pre' ? `Calentamiento · el arco empieza en ${arc.daysUntilStart} día(s)` : `Día ${arc.day} de ${arc.total} · Fase ${arc.phase}: ${arc.phaseName}`;
    return this.head('☰', `${isToday ? 'Hoy' : 'Ayer'} · ${prettyDate(date, true)}`, sub) + `<div class="panel-body">${body}</div>` + this.foot(s, date);
  }

  /** Prioridad de hoy: la "prioridad de mañana" que escribiste anoche en el diario. */
  private priorityBlock(s: GameState) {
    const today = this.app.today;
    const p = dayPriority(s, today);
    if (!p) {
      return `<div class="note">🎯 Esta noche, en el diario, escribe <b>tu prioridad de mañana</b>: aparecerá aquí para que empieces por lo importante.</div>`;
    }
    const done = !!s.log[today]?.priorityDone;
    return `<div class="quest priority ${done ? 'done' : ''}">
      <button class="check" data-action="priority" data-key="priority" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar'} prioridad del día">✓</button>
      <div class="q-title"><small class="kicker">🎯 Prioridad de hoy · de tu diario de anoche</small>${esc(p)}</div><span class="q-xp">+${PRIORITY_XP} XP</span>
    </div>`;
  }

  private renderJournal(s: GameState) {
    const today = this.app.today;
    const q = journalQuest(s);
    const entry = s.log[today]?.journal;
    let body = '';
    if (entry) {
      body += `<div class="note"><b>Hoy escribiste:</b><br>✓ ${esc(entry.good) || '—'}<br>↗ ${esc(entry.improve) || '—'}<br>→ ${esc(entry.tomorrow) || '—'}</div>`;
      body += `<button class="btn" data-action="journal" data-key="journal">✎ Editar diario de hoy</button>`;
    } else {
      body += `<div class="note">Tres líneas antes de dormir: <b>qué salió bien</b>, <b>qué mejorar</b> y <b>la prioridad de mañana</b> (mañana la verás como tu prioridad del día). La ventana se iluminará al guardarlo.</div>`;
      body += `<button class="btn primary" data-action="journal" data-key="journal">✍️ Escribir el diario de hoy${q?.active ? ` · +${q.xp} XP` : ''}</button>`;
    }
    const y = addDays(today, -1);
    if (canEditDate(s, y, today) && !s.log[y]?.journal) {
      body += ` <button class="btn" data-action="journal" data-date="${y}" data-key="journal-y">✎ Escribir el de ayer</button>`;
    }
    const past = Object.keys(s.log).filter((d) => d < today && s.log[d].journal).sort().reverse().slice(0, 5);
    if (past.length) {
      body += `<div class="section-title">Días anteriores</div>`;
      for (const d of past) {
        const j = s.log[d].journal!;
        body += `<div class="note"><b>${esc(prettyDate(d, true))}</b><br>✓ ${esc(j.good) || '—'}<br>↗ ${esc(j.improve) || '—'}<br>→ ${esc(j.tomorrow) || '—'}</div>`;
      }
    }
    return this.head('✍️', 'Ventana · Diario nocturno', 'Reflexión: mirar la ciudad y ordenar el día', this.app.derived!.objects.window)
      + `<div class="panel-body">${body}</div>` + this.foot(s);
  }

  private renderGoals(s: GameState) {
    const today = this.app.today;
    const d = this.app.derived!;
    let body = '';
    const step = activeQuests(s, today).find((q) => hasTag(q, 'goalstep'));
    if (step) body += `<div class="section-title">Hoy</div>` + this.row(s, step, today);
    body += `<div class="section-title">Metas del arco</div>`;
    body += s.goals.map((g) => {
      const n = goalStepCount(s, g.id);
      return `<div class="goal-row ${g.done ? 'done' : ''}">
        <button class="check" data-action="goal" data-id="${esc(g.id)}" data-key="goal-${esc(g.id)}" aria-pressed="${g.done}" aria-label="${g.done ? 'Desmarcar' : 'Marcar como cumplida'} meta: ${esc(g.text)}">✓</button>
        <span class="txt">${esc(g.text)}<small class="steps">${n} paso${n === 1 ? ' dado' : 's dados'}${g.done ? ' · cumplida' : ''}</small></span><span class="q-xp">+${GOAL_XP} XP</span></div>`;
    }).join('');
    if (!s.goals.length) body += `<div class="note">Sin metas no hay hacia dónde dar pasos. Añade una abajo.</div>`;
    if (s.goals.length < 3) {
      body += `<form class="inline-form" data-form="goal"><input class="field" name="goal" maxlength="80" placeholder="Añadir una meta (máx. 3)" aria-label="Nueva meta"><button class="btn" data-key="goal-add">Añadir</button></form>`;
    }
    const boss = s.quests.filter((q) => hasTag(q, 'boss') && q.active);
    if (boss.length) {
      body += `<div class="section-title">Reto semanal</div>`;
      if (d.arc.phase < 2) {
        body += `<div class="note">Los retos "jefe" aparecen en la <b>fase 2: Construcción</b> (desde el ${esc(prettyDate(arcInfo(s.arc, today).phaseStarts[1]))}).</div>`;
      } else {
        body += boss.map((q) => this.row(s, q, today, bossChallenge(s, today))).join('');
      }
    }
    const reviewOpen = d.arc.phase === 3 || d.arc.status === 'post';
    body += `<div class="section-title">Tu arco</div><div class="stats">
      <div class="stat"><div class="v">${d.streak}</div><div class="k">racha actual</div></div>
      <div class="stat"><div class="v">${bestStreak(s, today)}</div><div class="k">mejor racha</div></div>
      <div class="stat"><div class="v">${s.xp}</div><div class="k">XP total</div></div>
    </div>
    <button class="btn" data-action="review" data-key="review" ${reviewOpen ? '' : `disabled title="Disponible en la fase 3 (desde el ${esc(prettyDate(d.arc.phaseStarts[2]))})"`}>📜 Revisión del arco</button>`;
    return this.head('📌', 'Corcho de metas', 'Metas del arco · pasos, hitos y retos', d.objects.corkboard) + `<div class="panel-body">${body}</div>` + this.foot(s);
  }

  // ------------------------------------------------------------------ filas

  private row(s: GameState, q: Quest, date: string, titleOverride?: string) {
    const isToday = date === this.app.today;
    const prog = questProgress(s, q, date);
    const goal = questGoal(q);
    const done = prog >= goal;
    const title = esc(titleOverride ?? questTitle(s, q));
    const star = q.minimumViable && q.kind === 'daily' ? `<span class="q-star" title="Cuenta para el día mínimo viable">★</span>` : '';
    const key = `q-${q.id}-${isToday ? 't' : 'y'}`;
    const dd = isToday ? '' : ` data-date="${date}"`;
    let control = '';
    let sub = '';
    const litCheck = `<span class="check" aria-hidden="true" style="pointer-events:none;${done ? 'background:radial-gradient(circle at 35% 30%,#ffe2a0,#ff9a3c);border-color:transparent;color:#3a1e05;box-shadow:0 0 16px rgba(255,170,60,.6)' : ''}">${done ? '✓' : ''}</span>`;
    if (hasTag(q, 'goalstep')) {
      control = litCheck;
      sub = `<div class="q-controls goal-chips" role="group" aria-label="¿Hacia qué meta?">${openGoals(s).map((g) => {
        const on = goalSteppedOn(s, g.id, date);
        return `<button class="chip ${on ? 'on' : ''}" data-action="step" data-id="${esc(g.id)}"${dd} data-key="${key}-${esc(g.id)}" aria-pressed="${on}">📌 ${esc(g.text)} <small>${goalStepCount(s, g.id)}</small></button>`;
      }).join('')}</div>`;
    } else if (q.mode === 'counter') {
      control = litCheck;
      sub = `<div class="q-controls">
        <span class="counter" role="group" aria-label="${title}">
          <button data-action="dec" data-id="${q.id}"${dd} data-key="${key}-dec" aria-label="Restar uno" ${prog <= 0 ? 'disabled' : ''}>−</button>
          <span class="val">${prog}/${goal}${q.unit ? ` <small>${esc(q.unit)}</small>` : ''}</span>
          <button data-action="inc" data-id="${q.id}"${dd} data-key="${key}-inc" aria-label="Sumar uno" ${done ? 'disabled' : ''}>+</button>
        </span>
        ${q.kind === 'weekly' ? '<span class="q-sub">esta semana</span>' : ''}
      </div>`;
    } else if (q.mode === 'text') {
      control = `<button class="check" data-action="journal"${dd} data-key="${key}" aria-pressed="${done}" aria-label="Escribir diario">${done ? '✓' : ''}</button>`;
      sub = `<div class="q-controls"><button class="btn small" data-action="journal"${dd} data-key="${key}-w">✎ ${done ? 'Editar' : 'Escribir'}</button></div>`;
    } else {
      control = `<button class="check" data-action="toggle" data-id="${q.id}"${dd} data-key="${key}" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar como hecha'}: ${title}">✓</button>`;
      if (q.mode === 'timer' && !done && isToday) {
        const t = s.meta.timer;
        const running = t && t.questId === q.id;
        sub = `<div class="q-controls">${running
          ? `<span class="num" data-timer>${fmtClock(timerRemaining(s, this.app.now()))}</span>`
          : `<button class="btn small" data-action="timer-start" data-id="${q.id}" data-key="${key}-t" ${t ? 'disabled title="Ya hay un temporizador en marcha"' : ''}>▶ ${q.target} min</button>`}
          <span class="q-sub">o márcala si ya lo hiciste</span></div>`;
      }
      if (q.kind === 'weekly' && !done) sub += `<div class="q-sub">pendiente esta semana</div>`;
    }
    const desc = q.description ? `<div class="q-desc">${esc(q.description)}</div>` : '';
    return `<div class="quest ${done ? 'done' : ''}">
      ${control}<div class="q-title">${title}${star}</div><span class="q-xp">+${q.xp} XP</span>
      ${desc}${sub}
    </div>`;
  }

  private lockedRow(s: GameState, q: Quest) {
    return `<div class="quest locked" aria-disabled="true">
      <span class="check" aria-hidden="true">🔒</span><div class="q-title">${esc(questTitle(s, q))}</div><span class="q-xp">+${q.xp} XP</span>
      <div class="q-desc">Se desbloquea en la fase ${q.phaseFrom}</div></div>`;
  }

  private timerBlock(s: GameState) {
    const t = s.meta.timer;
    const pomo = s.quests.find((q) => hasTag(q, 'pomodoro') && q.mode === 'timer' && q.active);
    if (!t) {
      if (!pomo) return '';
      return `<div class="timer">
        <div class="grow"><div class="clock">${String(pomo.target ?? 25).padStart(2, '0')}:00</div><div class="label">Pomodoro · ${pomo.target ?? 25} min de foco + 5 de descanso</div></div>
        <div class="actions"><button class="btn primary" data-action="timer-start" data-id="${pomo.id}" data-key="pomo-start">▶ Empezar</button></div>
      </div>`;
    }
    const q = t.questId ? findQuest(s, t.questId) : null;
    const label = t.kind === 'break' ? 'Descanso · levántate, estira, bebe agua' : `${q ? esc(questTitle(s, q)) : 'Foco'} · se completa al llegar a 0`;
    return `<div class="timer ${t.kind === 'break' ? 'break' : ''}">
      <div class="grow"><div class="clock" data-timer>${fmtClock(timerRemaining(s, this.app.now()))}</div><div class="label">${label}</div></div>
      <div class="actions">
        ${t.endsAt === null
          ? `<button class="btn" data-action="timer-resume" data-key="t-resume" aria-label="Reanudar">▶</button>`
          : `<button class="btn" data-action="timer-pause" data-key="t-pause" aria-label="Pausar">⏸</button>`}
        <button class="btn" data-action="timer-cancel" data-key="t-cancel" aria-label="Cancelar temporizador">✕</button>
      </div>
    </div>`;
  }

  /** Actualiza solo los relojes (cada 250 ms) sin re-renderizar el panel. */
  updateTimers() {
    const s = this.app.state;
    if (!s || !this.current) return;
    const txt = fmtClock(timerRemaining(s, this.app.now()));
    this.el.querySelectorAll<HTMLElement>('[data-timer]').forEach((n) => {
      if (n.textContent !== txt) n.textContent = txt;
    });
    // si el temporizador terminó o cambió de tipo, re-render
    const hasBlock = !!this.el.querySelector('.timer [data-timer]');
    if (this.current === 'desk' && hasBlock !== !!s.meta.timer) this.render();
  }

  // ------------------------------------------------------------------ eventos

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const app = this.app;
    const id = b.dataset.id ?? '';
    const date = b.dataset.date ?? app.today;
    if (app.state && !canEditDate(app.state, date, app.today)) return;
    const origin = (q: string) => {
      const quest = app.state && findQuest(app.state, q);
      return quest ? questObject(quest) : undefined;
    };
    switch (b.dataset.action) {
      case 'close': this.close(); break;
      case 'day': this.day = b.dataset.day === 'yesterday' ? 'yesterday' : 'today'; this.render(); break;
      case 'open-yesterday': this.open('today', 'yesterday'); break;
      case 'toggle': app.act((s, d) => toggleQuest(s, id, d), origin(id), date); break;
      case 'inc': app.act((s, d) => incrementQuest(s, id, d, 1), origin(id), date); break;
      case 'dec': app.act((s, d) => incrementQuest(s, id, d, -1), origin(id), date); break;
      case 'step': app.act((s, d) => toggleGoalStep(s, id, d), 'corkboard', date); break;
      case 'priority': app.act((s, d) => togglePriority(s, d), 'window'); break;
      case 'timer-start': app.act((s, d) => startTimer(s, id, app.now(), d), 'desk'); break;
      case 'timer-pause': app.act((s) => pauseTimer(s, app.now())); break;
      case 'timer-resume': app.act((s) => resumeTimer(s, app.now())); break;
      case 'timer-cancel': app.act((s) => cancelTimer(s)); break;
      case 'journal': app.modals.journal(date); break;
      case 'goal': app.act((s, d) => toggleGoal(s, id, d), 'corkboard'); break;
      case 'review': app.modals.review(); break;
      case 'reduced': app.act((s, d) => setReducedMode(s, d, !s.log[d]?.reducedMode)); break;
      case 'rest':
        app.act((s, d) => {
          if (useRestToken(s, d)) app.hud.toast('❄️ Descanso planeado. Hoy cuenta para la racha. Disfrútalo.', 'ice');
        });
        break;
    }
  }

  private onSubmit(e: Event) {
    const form = e.target as HTMLFormElement;
    if (form.dataset.form !== 'goal') return;
    e.preventDefault();
    const input = form.elements.namedItem('goal') as HTMLInputElement;
    const text = input.value;
    this.app.act((s) => addGoal(s, text));
  }
}
