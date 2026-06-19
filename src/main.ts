import './styles.css';
import { initSim, updateSim, renderSim, initSimPRNG, SIM_W, SIM_H } from './game/sandSim';
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

// Seed the sim PRNG from the game seed so both start deterministically together.
// The +1 offset keeps the two PRNGs independent (same seed would produce identical streams).
initSimPRNG(gs.prng.seed + 1);

// ─── UI ───────────────────────────────────────────────────────────────────────
const appEl = document.getElementById('app')!;

function render(): void {
  renderUI(gs, appEl);
}

initUI(gs, canvas, render);
initSim();
render();

// ─── Game loop ────────────────────────────────────────────────────────────────
// Rendering uses requestAnimationFrame for smooth display.
// Gameplay/simulation advances by integer ticks at a fixed rate (~30/sec).
// gs.tick is the authoritative clock; wall-clock time is rendering-only.
let lastSimTime = 0;
const TICK_MS = 33; // fixed ~30 ticks/sec

function loop(ts: number): void {
  if (ts - lastSimTime >= TICK_MS) {
    gs.tick++;
    updateSim();
    renderSim(ctx);
    renderGeneratorStructures(ctx, gs);
    lastSimTime = ts;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
