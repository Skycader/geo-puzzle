import { levels } from '../levels/index.js';
import { Game } from './game.js';

window.addEventListener('DOMContentLoaded', () => {
  new Game({ levels });
});
