import { describe, expect, it } from 'vitest';
import { exportJSON, importJSON, Store } from './storage';
import { setQuestDone } from './quests';
import { newGame } from './testutil';

class MemStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('almacenamiento', () => {
  it('exporta e importa sin perder datos', () => {
    const s = newGame();
    setQuestDone(s, 'cuerpo-mover', '2026-10-05', true);
    const back = importJSON(exportJSON(s));
    expect(back).toEqual(s);
  });

  it('rechaza versiones y archivos no válidos', () => {
    expect(() => importJSON('no es json')).toThrow(/JSON/);
    expect(() => importJSON(JSON.stringify({ ...newGame(), version: 2 }))).toThrow(/Versión/);
    expect(() => importJSON(JSON.stringify({ ...newGame(), xp: -5 }))).toThrow(/XP/);
  });

  it('guarda con debounce en localStorage y recarga', async () => {
    const backend = new MemStorage() as unknown as Storage;
    const store = new Store(backend);
    expect(store.available).toBe(true);
    const s = newGame();
    store.save(s);
    expect(backend.getItem('winterArcRoom.v1')).toBeNull();
    await new Promise((r) => setTimeout(r, 350));
    expect(new Store(backend).load()).toEqual(s);
  });

  it('funciona en memoria si no hay localStorage', () => {
    const store = new Store(null);
    expect(store.available).toBe(false);
    const s = newGame();
    store.save(s);
    store.flush();
    expect(store.load()).toEqual(s);
  });
});
