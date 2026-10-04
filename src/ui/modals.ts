// Modales: pantalla de inicio, diario nocturno, resumen semanal, ajustes y mensajes.
import type { App } from '../app';
import { addDays, arcEndFor, arcInfo, arcLength, DEFAULT_START, phaseLengths, prettyDate, weekStart } from '../game/calendar';
import { bossChallenge, bossQuest, isQuestDone, journalQuest, saveJournal } from '../game/quests';
import { applyAdjustment, arcReview, arcWeeks, computeStreak, weekSummary, type Adjustment } from '../game/streaks';
import { levelFor } from '../game/progression';
import { exportJSON, importJSON } from '../game/storage';
import { createState, PILLAR_DEFS, pillarDef, questsForIntensity, QUEST_TEMPLATE, questTitle, type Intensity } from '../game/state';
import { download, el, esc } from './dom';

type Cleanup = () => void;

export class Modals {
  private overlay: HTMLElement | null = null;
  private closable = true;
  private lastFocus: HTMLElement | null = null;
  private cleanup: Cleanup | null = null;
  private queue: (() => void)[] = [];

  constructor(private root: HTMLElement, private app: App) {}

  isOpen() {
    return !!this.overlay;
  }

  /**
   * Encola una acción para cuando no haya ningún modal abierto (p. ej. reentrada → resumen →
   * tarjeta de fase). Las acciones que no abren modal se ejecutan seguidas.
   */
  enqueue(action: () => void) {
    this.queue.push(action);
    this.drain();
  }

  private drain() {
    while (!this.overlay && this.queue.length) this.queue.shift()!();
  }

  private show(html: string, opts: { closable?: boolean; label: string } = { label: '' }): HTMLElement {
    this.close(true);
    this.closable = opts.closable ?? true;
    this.lastFocus = document.activeElement as HTMLElement | null;
    const overlay = el('div', 'overlay');
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(opts.label)}">${this.closable ? '<button class="icon-btn close" data-close aria-label="Cerrar">✕</button>' : ''}${html}</div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && this.closable) this.close();
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
    });
    overlay.addEventListener('keydown', (e) => this.trapFocus(e));
    this.root.append(overlay);
    this.overlay = overlay;
    this.app.hud.tooltip(null, 0, 0);
    requestAnimationFrame(() => overlay.querySelector<HTMLElement>('[autofocus], input, textarea, .modal button:not([data-close])')?.focus());
    return overlay.querySelector('.modal') as HTMLElement;
  }

  close(silent = false) {
    if (!this.overlay) return;
    if (!silent && !this.closable) return;
    this.cleanup?.();
    this.cleanup = null;
    this.overlay.remove();
    this.overlay = null;
    if (!silent) {
      this.lastFocus?.focus?.({ preventScroll: true });
      setTimeout(() => this.drain(), 120);
    }
  }

  private trapFocus(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.closable) {
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== 'Tab' || !this.overlay) return;
    const items = [...this.overlay.querySelectorAll<HTMLElement>('button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])')].filter((n) => !(n as HTMLButtonElement).disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ------------------------------------------------------------------ pantalla de inicio

  onboarding() {
    const today = this.app.today;
    const year = today.slice(0, 4);
    const defStart = today < DEFAULT_START ? DEFAULT_START : today;
    const data = { start: defStart, intensity: 'normal' as Intensity, bedtime: '23:30', goals: ['', '', ''] };
    let step = 1;

    const counts = (i: Intensity) => questsForIntensity(QUEST_TEMPLATE, i).filter((q) => q.active && q.kind === 'daily' && (q.phaseFrom ?? 1) === 1).length;
    const arcLine = () => {
      if (data.start > arcEndFor(data.start)) return '';
      const total = arcLength(data.start, arcEndFor(data.start));
      const [a, b, c] = phaseLengths(total);
      const pre = data.start > today ? ` Hasta entonces, calentamiento: las tareas ya cuentan.` : '';
      return `Termina el <b>31 dic</b> · <b>${total} días</b> · Cimientos (${a}), Construcción (${b}) y Remate (${c}).${pre}`;
    };

    const render = () => {
      const steps = `<div class="steps" aria-label="Paso ${step} de 3">${[1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
      let html = '';
      if (step === 1) {
        html = `${steps}<div class="brand">❄ Winter Arc Room</div>
          <h2>Tu habitación es tu progreso</h2>
          <p class="lead">Cada tarea real que cumples enciende una luz. Del inicio de tu arco al 31 de diciembre, este cuarto pasará de oscuro y desordenado a cálido y vivo.</p>
          <label class="lbl" for="ob-start">¿Cuándo empieza tu arco?</label>
          <input class="field" type="date" id="ob-start" value="${data.start}" min="${addDays(today, -60)}" max="${year}-12-24">
          <div class="q-controls" style="margin-top:8px">
            <button class="btn small" data-start="${DEFAULT_START > today ? DEFAULT_START : today}">${DEFAULT_START > today ? '5 oct · recomendado' : 'Hoy'}</button>
            ${DEFAULT_START > today ? `<button class="btn small" data-start="${today}">Empezar hoy</button>` : ''}
          </div>
          <div class="note" data-arcline>${arcLine()}</div>
          <div class="modal-actions"><button class="btn primary" data-next>Siguiente →</button></div>`;
      } else if (step === 2) {
        const opt = (i: Intensity, name: string, txt: string) => `<button class="choice" role="radio" aria-checked="${data.intensity === i}" data-int="${i}"><b>${name}</b><span>${txt}</span></button>`;
        html = `${steps}<h2>¿Con qué intensidad?</h2>
          <p class="lead">Adherencia antes que intensidad: un sistema que castiga demasiado se abandona en la semana 3. Podrás ajustarlo cuando quieras.</p>
          <div class="choice-grid" role="radiogroup" aria-label="Intensidad">
            ${opt('suave', 'Suave', `${counts('suave')} tareas al día. Solo lo esencial ★.`)}
            ${opt('normal', 'Normal', `${counts('normal')} tareas al día. Recomendado.`)}
            ${opt('intensa', 'Intensa', `${counts('intensa')} tareas al día. A por todas.`)}
          </div>
          <label class="lbl" for="ob-bed">Tu hora objetivo para acostarte</label>
          <input class="field" type="time" id="ob-bed" value="${data.bedtime}" style="max-width:160px">
          <div class="note">★ <b>Día mínimo viable:</b> con 3 tareas ★ el día cuenta para la racha. Hay días malos y tokens de descanso. La habitación <b>nunca retrocede</b>.</div>
          <div class="modal-actions"><button class="btn left" data-back>← Atrás</button><button class="btn primary" data-next>Siguiente →</button></div>`;
      } else {
        const ph = ['Terminar un curso', 'Correr 10 km', 'Ahorrar 300 €'];
        html = `${steps}<h2>Tus metas del arco</h2>
          <p class="lead">Escribe de 1 a 3 metas para el 31 de diciembre. Se clavarán en el corcho de la pared.</p>
          ${data.goals.map((g, i) => `<input class="field" style="margin-top:8px" data-goal="${i}" maxlength="80" value="${esc(g)}" placeholder="${ph[i]}" aria-label="Meta ${i + 1}">`).join('')}
          <div class="note" data-err hidden style="border-color:var(--danger);color:var(--danger)">Escribe al menos una meta.</div>
          <div class="modal-actions"><button class="btn left" data-back>← Atrás</button><button class="btn primary" data-go>Empezar el arco ❄</button></div>`;
      }
      const m = this.show(html, { closable: false, label: 'Pantalla de inicio' });
      wire(m);
    };

    const wire = (m: HTMLElement) => {
      const start = m.querySelector<HTMLInputElement>('#ob-start');
      start?.addEventListener('input', () => {
        if (start.value) data.start = start.value;
        m.querySelector('[data-arcline]')!.innerHTML = arcLine();
      });
      m.querySelectorAll<HTMLElement>('[data-start]').forEach((b) => b.addEventListener('click', () => {
        data.start = b.dataset.start!;
        start!.value = data.start;
        m.querySelector('[data-arcline]')!.innerHTML = arcLine();
      }));
      m.querySelectorAll<HTMLElement>('[data-int]').forEach((b) => b.addEventListener('click', () => {
        data.intensity = b.dataset.int as Intensity;
        m.querySelectorAll('[data-int]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      }));
      m.querySelector<HTMLInputElement>('#ob-bed')?.addEventListener('input', (e) => (data.bedtime = (e.target as HTMLInputElement).value || '23:30'));
      m.querySelectorAll<HTMLInputElement>('[data-goal]').forEach((inp) => inp.addEventListener('input', () => (data.goals[Number(inp.dataset.goal)] = inp.value)));
      m.querySelector('[data-next]')?.addEventListener('click', () => { step++; render(); });
      m.querySelector('[data-back]')?.addEventListener('click', () => { step--; render(); });
      m.querySelector('[data-go]')?.addEventListener('click', () => {
        if (!data.goals.some((g) => g.trim())) {
          (m.querySelector('[data-err]') as HTMLElement).hidden = false;
          m.querySelector<HTMLInputElement>('[data-goal="0"]')?.focus();
          return;
        }
        const state = createState({ start: data.start, intensity: data.intensity, bedtime: data.bedtime, goals: data.goals, today });
        this.close(true);
        this.app.begin(state);
      });
    };
    render();
  }

  // ------------------------------------------------------------------ diario

  journal(date = this.app.today) {
    const s = this.app.state;
    if (!s) return;
    const isToday = date === this.app.today;
    const j = s.log[date]?.journal ?? { good: '', improve: '', tomorrow: '' };
    const q = journalQuest(s);
    const already = q ? isQuestDone(s, q, date) : false;
    const m = this.show(`
      <h2>Diario nocturno${isToday ? '' : ' de ayer'}</h2>
      <p class="lead">${esc(prettyDate(date, true))} · tres líneas, sin presión.</p>
      <label class="lbl" for="j-good">✓ Qué salió bien ${isToday ? 'hoy' : 'ayer'}</label>
      <textarea class="field" id="j-good" maxlength="400" rows="2">${esc(j.good)}</textarea>
      <label class="lbl" for="j-imp">↗ Qué mejorar</label>
      <textarea class="field" id="j-imp" maxlength="400" rows="2">${esc(j.improve)}</textarea>
      <label class="lbl" for="j-tom">→ Prioridad de mañana <small style="color:var(--faint)">(${isToday ? 'mañana la verás como tu prioridad del día' : 'era la de hoy'})</small></label>
      <textarea class="field" id="j-tom" maxlength="400" rows="2">${esc(j.tomorrow)}</textarea>
      <div class="modal-actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" data-save>Guardar${q?.active && !already ? ` · +${q.xp} XP` : ''}</button></div>`, { label: 'Diario nocturno' });
    m.querySelector('[data-save]')!.addEventListener('click', () => {
      const entry = {
        good: (m.querySelector('#j-good') as HTMLTextAreaElement).value,
        improve: (m.querySelector('#j-imp') as HTMLTextAreaElement).value,
        tomorrow: (m.querySelector('#j-tom') as HTMLTextAreaElement).value,
      };
      this.close();
      this.app.act((st, d) => saveJournal(st, d, entry), 'window', date);
      this.app.flash('window');
    });
  }

  // ------------------------------------------------------------------ resumen semanal

  summary(offset = 0) {
    const s = this.app.state;
    if (!s) return;
    const today = this.app.today;
    const ws = addDays(weekStart(today), -7 * offset);
    if (offset < 0) {
      this.message('Esa semana aún no ha llegado', `La planta de la semana del ${prettyDate(ws)} se iluminará día a día cuando la vivas.`, '🏗️');
      return;
    }
    const upTo = offset === 0 ? today : addDays(ws, 6);
    const sum = weekSummary(s, ws, upTo);
    const weekNo = arcWeeks(s).indexOf(ws) + 1;
    const info = arcInfo(s.arc, upTo);
    const boss = bossQuest(s);
    const bossLine = boss?.active && info.phase >= 2 && offset === 0
      ? `<div class="note">⚔️ <b>Reto de esta semana:</b> ${esc(bossChallenge(s, today))}${isQuestDone(s, boss, today) ? ' · ✓ cumplido' : ''}</div>` : '';
    const adj = offset === 0 ? sum.adjustment : undefined;
    const m = this.show(`
      <h2>Resumen semanal</h2>
      <p class="lead">${weekNo > 0 ? `Semana ${weekNo} del arco (planta ${weekNo} del edificio) · ` : ''}del ${esc(prettyDate(sum.start))} al ${esc(prettyDate(sum.end))}${offset === 0 ? ' · en curso' : ''}</p>
      <div class="stats">
        <div class="stat"><div class="v">${sum.validDays}/${Math.max(sum.daysElapsed, 0) || 7}</div><div class="k">días válidos</div></div>
        <div class="stat"><div class="v">+${sum.xp}</div><div class="k">XP ganado</div></div>
        <div class="stat"><div class="v">${computeStreak(s, today)}</div><div class="k">racha actual</div></div>
      </div>
      ${sum.best ? `<div class="note">🌟 <b>Lo que más cumpliste:</b> ${esc(sum.best.title)} (${Math.round(sum.best.rate * 100)} %)</div>` : ''}
      ${sum.worst ? `<div class="note">🌱 <b>Lo que más costó:</b> ${esc(sum.worst.title)} (${Math.round(sum.worst.rate * 100)} %)</div>` : ''}
      ${!sum.best && !sum.daysElapsed ? '<div class="note">Esta semana todavía no tiene días registrados.</div>' : ''}
      ${bossLine}
      ${adj ? `<div class="note" style="border-style:solid;border-color:rgba(255,179,71,.4)"><b>Una pregunta:</b> ${esc(adj.question)}
        <div class="q-controls" style="margin-top:10px"><button class="btn primary small" data-adj-yes>Sí, ajustar</button><button class="btn small" data-adj-no>No, mantener</button></div></div>` : ''}
      <div class="modal-actions">
        <button class="btn left" data-prev>← Semana anterior</button>
        ${offset > 0 ? '<button class="btn" data-nextw>Semana siguiente →</button>' : ''}
        <button class="btn primary" data-close>Cerrar</button>
      </div>`, { label: 'Resumen semanal' });
    m.querySelector('[data-prev]')?.addEventListener('click', () => this.summary(offset + 1));
    m.querySelector('[data-nextw]')?.addEventListener('click', () => this.summary(offset - 1));
    m.querySelector('[data-adj-yes]')?.addEventListener('click', () => {
      this.app.act((st, d) => applyAdjustment(st, adj as Adjustment, d));
      this.app.hud.toast('Ajuste aplicado. Puedes cambiarlo en Ajustes → Tareas.');
      this.close();
    });
    m.querySelector('[data-adj-no]')?.addEventListener('click', () => {
      (m.querySelector('[data-adj-no]') as HTMLElement).closest('.note')!.remove();
    });
  }

  // ------------------------------------------------------------------ ajustes

  settings() {
    const s = this.app.state;
    if (!s) return;
    const sw = (key: string, on: boolean, t: string, d: string) => `<div class="toggle-row"><div><div class="t">${t}</div><div class="d">${d}</div></div>
      <button class="switch" role="switch" aria-checked="${on}" data-toggle="${key}" aria-label="${esc(t)}"></button></div>`;
    const groups = PILLAR_DEFS.map((p) => {
      const qs = s.quests.filter((q) => q.pillar === p.id);
      return `<details class="group"><summary>${p.icon} ${esc(p.name)} · ${qs.filter((q) => q.active).length}/${qs.length} activas</summary>
        ${qs.map((q) => sw(`q:${q.id}`, q.active, esc(questTitle(s, q)) + (q.minimumViable && q.kind === 'daily' ? ' <span class="q-star">★</span>' : ''),
          `${q.kind === 'daily' ? 'Diaria' : q.kind === 'weekly' ? 'Semanal' : 'Del arco'} · +${q.xp} XP${q.phaseFrom && q.phaseFrom > 1 ? ` · desde la fase ${q.phaseFrom}` : ''}`)).join('')}
      </details>`;
    }).join('');
    const m = this.show(`
      <h2>Ajustes</h2>
      <p class="lead">Arco del ${esc(prettyDate(s.arc.start))} al ${esc(prettyDate(s.arc.end))} · intensidad ${esc(s.arc.intensity)}</p>
      ${sw('sound', s.settings.sound, 'Sonido', 'Tonos sintetizados suaves al completar tareas')}
      ${sw('motion', s.settings.reducedMotion, 'Reducir movimiento', 'Sin parallax y con menos partículas')}
      <div class="toggle-row"><div><div class="t">Hora objetivo para acostarte</div><div class="d">Se usa en la tarea de Sueño</div></div>
        <input class="field" type="time" data-bedtime value="${esc(s.arc.bedtime)}" style="width:150px"></div>
      <div class="section-title">Tareas</div>
      ${groups}
      <div class="section-title">Tus datos</div>
      <p class="lead" style="margin:0 0 8px">Todo se guarda solo en este navegador. Exporta una copia de vez en cuando.</p>
      <div class="q-controls">
        <button class="btn" data-export>⬇ Exportar JSON</button>
        <button class="btn" data-import>⬆ Importar JSON</button>
        <input type="file" accept="application/json,.json" data-file hidden>
      </div>
      <div class="note" data-msg hidden></div>
      <div class="section-title">Zona delicada</div>
      <div data-reset-zone><button class="btn danger" data-reset>Reiniciar arco…</button></div>
      <p class="lead" style="margin-top:14px;font-size:12px">Depuración: abre la consola y usa <code>__debug.help()</code>.</p>`, { label: 'Ajustes' });

    m.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tg = t.closest<HTMLElement>('[data-toggle]');
      if (tg) {
        const key = tg.dataset.toggle!;
        const on = tg.getAttribute('aria-checked') !== 'true';
        tg.setAttribute('aria-checked', String(on));
        this.app.act((st, d) => {
          if (key === 'sound') { st.settings.sound = on; this.app.sfx.setEnabled(on); }
          else if (key === 'motion') { st.settings.reducedMotion = on; }
          else if (key.startsWith('q:')) {
            return applyAdjustment(st, { kind: on ? 'raise' : 'lower', questId: key.slice(2), question: '', change: { active: on } }, d);
          }
        });
        this.app.applyReducedMotionClass();
        return;
      }
      if (t.closest('[data-export]')) {
        download(`winter-arc-room-${this.app.today}.json`, exportJSON(this.app.state!));
        this.msg(m, 'Copia exportada.');
      }
      if (t.closest('[data-import]')) m.querySelector<HTMLInputElement>('[data-file]')!.click();
      if (t.closest('[data-reset]')) {
        m.querySelector('[data-reset-zone]')!.innerHTML = `<div class="note" style="border-color:var(--danger)"><b>¿Seguro?</b> Se borrará todo el progreso (XP, rachas, diario). Exporta antes si quieres conservarlo.
          <div class="q-controls" style="margin-top:10px"><button class="btn danger" data-reset2>Sí, borrar todo</button><button class="btn" data-reset-cancel>Cancelar</button></div></div>`;
      }
      if (t.closest('[data-reset-cancel]')) {
        m.querySelector('[data-reset-zone]')!.innerHTML = `<button class="btn danger" data-reset>Reiniciar arco…</button>`;
      }
      if (t.closest('[data-reset2]')) {
        if (!window.confirm('Última confirmación: ¿borrar el arco y empezar de cero?')) return;
        this.resetArc();
      }
    });
    m.querySelector<HTMLInputElement>('[data-bedtime]')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (v) this.app.act((st) => { st.arc.bedtime = v; });
    });
    m.querySelector<HTMLInputElement>('[data-file]')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const state = importJSON(await file.text());
        this.app.state = state;
        this.app.applyReducedMotionClass();
        this.app.sfx.setEnabled(state.settings.sound);
        this.app.checkDay(true);
        this.app.afterChange();
        this.close(true);
        this.app.hud.toast('Datos importados correctamente.');
      } catch (err) {
        this.msg(m, `No se pudo importar: ${(err as Error).message}`, true);
      }
    });
  }

  private msg(m: HTMLElement, text: string, error = false) {
    const n = m.querySelector<HTMLElement>('[data-msg]')!;
    n.hidden = false;
    n.textContent = text;
    n.style.borderColor = error ? 'var(--danger)' : '';
    n.style.color = error ? 'var(--danger)' : '';
  }

  /** Borra la partida y vuelve a la pantalla de inicio. */
  private resetArc() {
    this.app.store.clear();
    this.app.state = null;
    this.app.panel.close();
    this.app.recompute();
    this.app.render();
    this.close(true);
    this.onboarding();
  }

  // ------------------------------------------------------------------ revisión final del arco

  review() {
    const s = this.app.state;
    if (!s) return;
    const today = this.app.today;
    const r = arcReview(s, today);
    const ended = today > s.arc.end;
    const lvl = levelFor(s.xp, s.arc.intensity);
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const goals = r.goals.length
      ? r.goals.map((g) => `<div class="goal-row ${g.done ? 'done' : ''}"><span class="check" aria-hidden="true" style="${g.done ? 'background:radial-gradient(circle at 35% 30%,#ffe2a0,#ff9a3c);border-color:transparent;color:#3a1e05' : ''}">${g.done ? '✓' : ''}</span>
          <span class="txt">${esc(g.text)}<small class="steps">${g.steps} paso${g.steps === 1 ? ' dado' : 's dados'}${g.done ? ' · cumplida' : ''}</small></span></div>`).join('')
      : '<div class="note">No escribiste metas para este arco.</div>';
    const top = r.pillars[0], low = r.pillars[r.pillars.length - 1];
    const m = this.show(`
      <div class="brand">📜 Revisión del arco</div>
      <h2>${ended ? 'Tu arco ha terminado' : 'Así va tu arco'}</h2>
      <p class="lead">Del ${esc(prettyDate(s.arc.start))} al ${esc(prettyDate(s.arc.end))}. ${ended ? 'Mira hasta dónde llegaste: cada planta iluminada del edificio es una semana vivida.' : `Quedan ${r.total - r.elapsed} días para cerrarlo.`}</p>
      <div class="stats">
        <div class="stat"><div class="v">${r.validDays}/${r.elapsed}</div><div class="k">días con el mínimo</div></div>
        <div class="stat"><div class="v">${r.bestStreak}</div><div class="k">mejor racha</div></div>
        <div class="stat"><div class="v">${r.strongWeeks}</div><div class="k">semanas sólidas (≥5 días)</div></div>
        <div class="stat"><div class="v">${lvl}</div><div class="k">nivel de habitación</div></div>
        <div class="stat"><div class="v">${r.xp}</div><div class="k">XP</div></div>
        <div class="stat"><div class="v">${r.journals}</div><div class="k">noches de diario</div></div>
      </div>
      <div class="section-title">Tus metas</div>${goals}
      ${top && top.rate > 0 ? `<div class="note">🌟 <b>Tu pilar más constante:</b> ${pillarDef(top.pillar).icon} ${esc(pillarDef(top.pillar).name)} (${pct(top.rate)} de las diarias).${low && low !== top ? ` El que más costó: ${pillarDef(low.pillar).icon} ${esc(pillarDef(low.pillar).name)} (${pct(low.rate)}).` : ''}</div>` : ''}
      <div data-new-zone class="modal-actions">
        <button class="btn left" data-export>⬇ Guardar recuerdo (JSON)</button>
        ${ended ? '<button class="btn" data-new>Empezar un nuevo arco…</button>' : ''}
        <button class="btn primary" data-close>Cerrar</button>
      </div>`, { label: 'Revisión del arco' });
    m.querySelector('[data-export]')!.addEventListener('click', () => download(`winter-arc-room-recuerdo-${s.arc.end}.json`, exportJSON(s)));
    m.querySelector('[data-new]')?.addEventListener('click', () => {
      m.querySelector('[data-new-zone]')!.innerHTML = `<div class="note" style="border-color:var(--danger);width:100%"><b>Un arco nuevo empieza de cero</b> (habitación a oscuras, sin XP). Guarda antes tu recuerdo si quieres conservarlo.
        <div class="q-controls" style="margin-top:10px"><button class="btn danger" data-new2>Sí, empezar de nuevo</button><button class="btn" data-close>Cancelar</button></div></div>`;
      m.querySelector('[data-new2]')!.addEventListener('click', () => this.resetArc());
    });
  }

  // ------------------------------------------------------------------ mensaje genérico

  message(title: string, body: string, icon = '✨') {
    this.show(`<div style="font-size:34px;margin-bottom:6px" aria-hidden="true">${icon}</div><h2>${esc(title)}</h2><p class="lead">${esc(body)}</p>
      <div class="modal-actions"><button class="btn primary" data-close>Entendido</button></div>`, { label: title });
  }
}
