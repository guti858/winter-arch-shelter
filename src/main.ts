// Arranque: almacenamiento, controlador y bucle principal.
import './ui/styles.css';
import { App } from './app';
import { Store } from './game/storage';

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const root = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, root, new Store(safeLocalStorage()));
app.installDebug();
app.start();
