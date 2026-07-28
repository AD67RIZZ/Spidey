import './style.css';
import { Game } from './game.js';

const loadingFill = document.querySelector('#loading-fill');
const loadingLabel = document.querySelector('#loading-label');
const loadingTrack = document.querySelector('.loading-track');

function setProgress(value, label) {
  const percent = Math.round(value * 100);
  loadingFill.style.width = `${percent}%`;
  loadingTrack.setAttribute('aria-valuenow', String(percent));
  if (label) loadingLabel.textContent = label;
}

async function boot() {
  setProgress(0.12, 'Warming up Aero’s flight systems…');
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const game = new Game(document.querySelector('#game-shell'), setProgress);
    await game.init();
    window.__SKYLINE_SLING__ = game;
    setProgress(1, 'Meridian City online.');

    window.setTimeout(() => {
      document.querySelector('#loading-screen').classList.add('hidden');
      document.querySelector('#start-screen').classList.remove('hidden');
      game.setMenuView();
    }, 350);
  } catch (error) {
    console.error('Skyline Sling failed to start:', error);
    document.querySelector('#loading-screen').classList.add('hidden');
    document.querySelector('#webgl-fallback').classList.remove('hidden');
  }
}

boot();
