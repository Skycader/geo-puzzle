import { levels } from '../levels/index.js';
import { Game } from './game.js';
import { initTooltips } from './tooltips.js';
import { startFpsMeter } from './fpsMeter.js';
import { startLongTaskObserver, initDebugConsole } from './perfDebug.js';

window.addEventListener('DOMContentLoaded', () => {
  initTooltips(); // before the Game: native title tooltips must be adopted before the first hover
  new Game({ levels });
  startFpsMeter();
  startLongTaskObserver();
  initDebugConsole();
});
