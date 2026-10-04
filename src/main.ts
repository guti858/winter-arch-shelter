// Arranque: almacenamiento, controlador y bucle principal.
import './ui/styles.css';
import { App } from './app';
import { Store } from './game/storage';
import { connectClaude } from './platform/claude';

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const root = document.getElementById('ui') as HTMLElement;
const store = new Store(safeLocalStorage());
const app = new App(canvas, root, store);
app.installDebug();
app.start();
// Solo hace algo si el juego se abre dentro del visor de artifacts de claude.ai
void connectClaude(app, store);
