import './ui/style.css';
import konya from '../data/konya.json';
import { Game } from './game';
import { createCity } from './sim/city';
import type { CityDef } from './sim/city-def';

const boot = document.getElementById('boot');

/** A phone has no console: any failure to start is written onto the page itself. */
function fail(message: string, detail: string): void {
  if (boot === null) return;
  boot.hidden = false;
  boot.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = message;
  const pre = document.createElement('pre');
  pre.textContent = `${detail}\n\n${navigator.userAgent}`;
  boot.append(p, pre);
}

declare global {
  interface Window {
    /** Hooks for the browser smoke test and for poking at the city from devtools. */
    __game?: Game;
  }
}

try {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const city = createCity(konya as unknown as CityDef);
  const game = new Game(canvas, ui, city);
  window.__game = game;
  game.start();
  requestAnimationFrame(() => {
    if (boot !== null) boot.hidden = true;
  });
} catch (err) {
  fail(
    'Oyun başlatılamadı. Tarayıcınız WebGL desteklemiyor olabilir.',
    err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
  );
}
