import { levels } from '../levels/index.js';
import { Game } from './game.js';
import { startFpsMeter } from './fpsMeter.js';

window.addEventListener('DOMContentLoaded', () => {
  new Game({ levels });
  startFpsMeter();
});
