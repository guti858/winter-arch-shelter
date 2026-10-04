// Pequeños helpers de DOM.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto del usuario antes de insertarlo como HTML. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function pct(v: number): string {
  return `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
}

/** Re-renderiza un contenedor conservando el foco del elemento con el mismo data-key. */
export function renderKeepFocus(container: HTMLElement, html: string) {
  const active = document.activeElement as HTMLElement | null;
  const key = active && container.contains(active) ? active.dataset.key : undefined;
  const scroll = container.querySelector('.panel-body')?.scrollTop ?? 0;
  container.innerHTML = html;
  const body = container.querySelector('.panel-body');
  if (body) body.scrollTop = scroll;
  if (key) (container.querySelector(`[data-key="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
}

type DownloadHandler = (filename: string, text: string) => void;
let downloadHandler: DownloadHandler = browserDownload;

/** Permite sustituir la descarga (p. ej. dentro de un visor que bloquea los enlaces de descarga). */
export function setDownloadHandler(h: DownloadHandler) {
  downloadHandler = h;
}

export function download(filename: string, text: string) {
  downloadHandler(filename, text);
}

function browserDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copia texto al portapapeles (debe llamarse dentro de un clic). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
