// Integración opcional con el visor de artifacts de claude.ai. Fuera de ese visor no hace nada:
// el juego funciona igual con localStorage y export/import.
//
// Dentro del visor:
// - guarda una copia privada de la partida en el almacén de la cuenta del jugador
//   (`data/users/<id>/partida`), así el progreso no depende del navegador y te sigue entre dispositivos;
// - usa el guardado de archivos del visor para "Exportar JSON" (los enlaces de descarga están bloqueados).
import type { App } from '../app';
import { importJSON } from '../game/storage';
import type { GameState } from '../game/state';
import type { Store } from '../game/storage';
import { setDownloadHandler } from '../ui/dom';

interface DocSnap { exists: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { get(): Promise<DocSnap>; set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }
interface DbApi { doc(path: string): DocRef }
interface UserApi { id(): Promise<string | null> }
interface DownloadsApi { save(r: { filename: string; data: string }): Promise<unknown> }
interface ClaudeHost { use(name: string): Promise<unknown> }

const WRITE_GAP_MS = 2000;

export async function connectClaude(app: App, store: Store) {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') return;

  // Exportar: el visor confirma el guardado del archivo
  const downloads = (await host.use('downloads').catch(() => null)) as DownloadsApi | null;
  if (downloads) {
    setDownloadHandler((filename, text) => {
      downloads.save({ filename, data: text }).then(
        () => app.hud.toast('Copia guardada.'),
        (e: { code?: string }) => {
          if (e?.code !== 'declined') app.hud.toast('No se pudo guardar el archivo aquí. Usa «Copiar JSON».');
        },
      );
    });
  }

  // Copia privada de la partida en la cuenta
  const [db, user] = (await Promise.all([host.use('db').catch(() => null), host.use('user').catch(() => null)])) as [DbApi | null, UserApi | null];
  if (!db || !user) return;
  const id = await user.id().catch(() => null);
  if (!id) return;
  let ref: DocRef;
  try {
    ref = db.doc(`data/users/${id}/partida`);
  } catch {
    return;
  }

  let remote: { savedAt: number; json: string } | null = null;
  try {
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : undefined;
    if (d && typeof d.json === 'string' && typeof d.savedAt === 'number') remote = { savedAt: d.savedAt, json: d.json };
  } catch {
    return; // sin acceso: seguimos solo con el navegador
  }

  let enabled = true;
  let writing = false;
  let queued: { state: GameState; text: string } | null = null;
  let lastWrite = 0;
  const write = async () => {
    if (writing || !queued || !enabled) return;
    const wait = lastWrite + WRITE_GAP_MS - Date.now();
    if (wait > 0) {
      setTimeout(write, wait);
      return;
    }
    const { state, text } = queued;
    queued = null;
    writing = true;
    try {
      await ref.set({ savedAt: state.meta.savedAt ?? Date.now(), json: text });
      lastWrite = Date.now();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'unavailable' && code !== 'resource_exhausted') {
        enabled = false; // sin permiso de escritura o fuera de cuota: solo navegador
        app.cloudSync = false;
      } else if (!queued) {
        queued = { state, text };
      }
    } finally {
      writing = false;
      if (queued) setTimeout(write, WRITE_GAP_MS);
    }
  };

  store.onFlush = (state, text) => {
    queued = { state, text };
    void write();
  };
  store.onClear = () => {
    queued = null;
    ref.delete().catch(() => undefined);
  };
  app.cloudSync = true;

  // ¿Qué copia es más reciente?
  const local = app.state;
  if (remote && (!local || remote.savedAt > (local.meta.savedAt ?? 0))) {
    try {
      app.loadState(importJSON(remote.json));
      app.hud.toast('☁️ Progreso recuperado de tu cuenta.', 'ice');
    } catch {
      // copia remota dañada: la sustituye la local en el próximo guardado
    }
  } else if (local) {
    store.save(local);
  }
}
