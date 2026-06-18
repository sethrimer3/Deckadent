import './styles.css';
import { initSim, updateSim, renderSim, SIM_W, SIM_H } from './game/sandSim';
import { createInitialGameState } from './game/state';
import { initUI, renderUI } from './game/ui';
import { renderGeneratorStructures } from './game/generatorVisuals';

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.width  = SIM_W;
canvas.height = SIM_H;
canvas.id = 'battle-canvas';
const ctx = canvas.getContext('2d')!;

// ─── Game state ───────────────────────────────────────────────────────────────
const gs = createInitialGameState();

// ─── UI ───────────────────────────────────────────────────────────────────────
const appEl = document.getElementById('app')!;

function render(): void {
  renderUI(gs, appEl);
}

initUI(gs, canvas, render);
initSim();
render();

// ─── Game loop ────────────────────────────────────────────────────────────────
let lastSimTime = 0;
const SIM_INTERVAL = 33; // ~30 fps for the sim

function loop(ts: number): void {
  if (ts - lastSimTime >= SIM_INTERVAL) {
    updateSim();
    renderSim(ctx);
    renderGeneratorStructures(ctx, gs);
    lastSimTime = ts;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
