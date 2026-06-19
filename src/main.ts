import './styles.css';
import { updateSim, renderSim, SIM_W, SIM_H } from './game/sandSim';
import { createInitialGameState } from './game/state';
import { initUI, renderUI } from './game/ui';
import { renderGeneratorStructures, renderBaseStructures } from './game/generatorVisuals';
import { renderCreatureEntities } from './game/battlefieldEntities';
import { resolveSimDamage } from './game/simDamage';
import { updateCombatEffects } from './game/combatEffects';

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.width  = SIM_W;
canvas.height = SIM_H;
canvas.id = 'battle-canvas';
const ctx = canvas.getContext('2d')!;

// ─── Game state ───────────────────────────────────────────────────────────────
const gs = createInitialGameState();
// Log the initial seed so it can be reproduced from the console.
console.info(`[Deckadent] initialSeed = 0x${gs.initialSeed.toString(16).padStart(8, '0')}`);

// ─── UI ───────────────────────────────────────────────────────────────────────
const appEl = document.getElementById('app')!;

function render(): void {
  renderUI(gs, appEl);
}

initUI(gs, canvas, render);
render();

// ─── Fixed-step game loop ─────────────────────────────────────────────────────
//
// requestAnimationFrame drives rendering at the display refresh rate.
// Gameplay/simulation advances by integer fixed ticks (FIXED_DT ms each).
// An accumulator absorbs leftover time so ticks stay aligned regardless of
// frame rate. Up to MAX_TICKS_PER_FRAME ticks run per frame to prevent the
// "spiral of death" when frames run slow.
//
// gs.tick is the authoritative clock. Wall-clock time (ts) is rendering-only.

const FIXED_DT         = 1000 / 30; // ~33.3 ms per tick — ~30 sim ticks/sec
const MAX_TICKS_PER_FRAME = 5;

let prevTs    = 0;
let accumulator = 0;

function loop(ts: number): void {
  // Cap dt to 200 ms to handle tab switching / focus loss without tick storms.
  const dt = Math.min(ts - prevTs, 200);
  prevTs = ts;
  accumulator += dt;

  let ticked = false;
  let tickCount = 0;

  while (accumulator >= FIXED_DT && tickCount < MAX_TICKS_PER_FRAME) {
    gs.tick++;
    updateCombatEffects(gs); // spawn particles from pending effects before sim step
    updateSim(gs.sim);
    resolveSimDamage(gs);    // particle-overlap damage check (runs every 30 ticks)
    accumulator -= FIXED_DT;
    tickCount++;
    ticked = true;
  }

  if (ticked) {
    // Render the sim + battlefield structures once per frame after all ticks.
    renderSim(ctx, gs.sim);
    renderGeneratorStructures(ctx, gs);
    renderBaseStructures(ctx, gs);
    renderCreatureEntities(ctx, gs);
  }

  requestAnimationFrame(loop);
}

// Kick off the loop from the first frame.
requestAnimationFrame(ts => { prevTs = ts; requestAnimationFrame(loop); });
