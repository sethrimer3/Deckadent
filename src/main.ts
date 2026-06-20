import './styles.css';
import { updateSim, renderSim, SIM_W, SIM_H } from './game/sandSim';
import { createInitialGameState } from './game/state';
import { initUI, renderUI } from './game/ui';
import { renderGeneratorStructures, renderBaseStructures } from './game/generatorVisuals';
import { renderCreatureEntities, drawBattlefieldLabels } from './game/battlefieldEntities';
import { resolveSimDamage } from './game/simDamage';
import { updateCombatEffects } from './game/combatEffects';
import { updateCreatureMovement } from './game/movement';
import { saveReplay, loadLatestReplay, verifyReplay } from './game/replay';
import { getCommandLog, getRejectedLog } from './game/commands';
import { hashHex } from './game/stateHash';

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.width  = SIM_W;
canvas.height = SIM_H;
canvas.id = 'battle-canvas';
const ctx = canvas.getContext('2d')!;

// ─── ?replay=latest — run verification before starting the game ───────────────
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('replay') === 'latest') {
  const rec = loadLatestReplay();
  if (rec) {
    const stamp = new Date(rec.timestamp).toLocaleString();
    console.info(`[Replay] Verifying replay from ${stamp} — seed=0x${rec.initialSeed.toString(16)}, outcome=${rec.outcome}`);
    const result = verifyReplay(rec);
    if (result.ok) {
      console.info(`[Replay] PASS ✓ — hash ${result.gotHash} in ${result.ticksRun} ticks (${result.commandsApplied} commands)`);
    } else {
      console.error(`[Replay] DESYNC ✗ — expected ${result.expectedHash} got ${result.gotHash}`);
    }
  } else {
    console.warn('[Replay] No valid replay found in localStorage. Play a game to completion first.');
  }
}

// ─── Game state ───────────────────────────────────────────────────────────────
const gs = createInitialGameState();
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
// Per-tick order:
//   1. gs.tick++
//   2. updateCombatEffects — spawn particles from pending effects
//   3. updateCreatureMovement — deterministic integer creature drift
//   4. updateSim — particle cellular automaton step
//   5. resolveSimDamage — particle-overlap damage (throttled to every 30 ticks)
//
// gs.tick is the authoritative clock. Wall-clock time is rendering-only.

const FIXED_DT            = 1000 / 30; // ~33.3 ms per tick — ~30 sim ticks/sec
const MAX_TICKS_PER_FRAME = 5;

let prevTs      = 0;
let accumulator = 0;
let _replaySaved = false;

function loop(ts: number): void {
  const dt = Math.min(ts - prevTs, 200);
  prevTs = ts;
  accumulator += dt;

  let ticked = false;
  let tickCount = 0;

  while (accumulator >= FIXED_DT && tickCount < MAX_TICKS_PER_FRAME) {
    gs.tick++;
    updateCombatEffects(gs);
    updateCreatureMovement(gs);
    updateSim(gs.sim);
    resolveSimDamage(gs);
    accumulator -= FIXED_DT;
    tickCount++;
    ticked = true;
  }

  // Save replay once when the game ends.
  if (gs.status !== 'playing' && !_replaySaved) {
    _replaySaved = true;
    saveReplay(gs);
  }

  if (ticked) {
    renderSim(ctx, gs.sim);
    renderGeneratorStructures(ctx, gs);
    renderBaseStructures(ctx, gs);
    renderCreatureEntities(ctx, gs);
    drawBattlefieldLabels(ctx, gs);
    updateDebugPanel();
  }

  requestAnimationFrame(loop);
}

// ─── Dev/debug panel ──────────────────────────────────────────────────────────
//
// Compact one-liner overlaid at the bottom of the battle canvas.
// Shows: seed · tick · hash · active fx count · accepted/rejected command counts.

let _debugEl: HTMLDivElement | null = null;

function updateDebugPanel(): void {
  if (!_debugEl) {
    _debugEl = document.createElement('div');
    _debugEl.id = 'debug-panel';
    Object.assign(_debugEl.style, {
      font: '10px/1.4 monospace',
      color: '#8cf',
      background: 'rgba(0,0,8,0.75)',
      padding: '1px 5px',
      position: 'absolute',
      bottom: '0',
      left: '0',
      right: '0',
      pointerEvents: 'none',
      zIndex: '10',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    });
    const slot = canvas.parentElement;
    if (slot) {
      if (getComputedStyle(slot).position === 'static') slot.style.position = 'relative';
      slot.appendChild(_debugEl);
    }
  }
  const hash     = hashHex(gs);
  const accepted = getCommandLog().length;
  const rejected = getRejectedLog().length;
  _debugEl.textContent =
    `seed 0x${gs.initialSeed.toString(16).padStart(8,'0')} · ` +
    `tick ${gs.tick} · ` +
    `hash ${hash} · ` +
    `fx ${gs.combatEffects.length} · ` +
    `cmds ${accepted}ok/${rejected}rej`;
}

// Kick off the loop from the first frame.
requestAnimationFrame(ts => { prevTs = ts; requestAnimationFrame(loop); });
