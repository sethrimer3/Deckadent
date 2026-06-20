import type { GameState } from './types';
import type { Command } from './commands';
import { applyCommand, getCommandLog, clearCommandLog } from './commands';
import { createInitialGameState, resetUidCounter } from './state';
import { updateCombatEffects } from './combatEffects';
import { updateCreatureMovement } from './movement';
import { updateSim } from './sandSim';
import { resolveSimDamage } from './simDamage';
import { hashHex } from './stateHash';

// ---------------------------------------------------------------------------
// Replay record format — written to localStorage on game end.
//
// v2 adds finalTick so verifyReplay can advance to the exact saved tick before
// comparing hashes. Records missing finalTick (v1) are rejected with a warning.
// ---------------------------------------------------------------------------
const REPLAY_VERSION = 'deckadent-replay-v2';
const STORAGE_KEY    = 'deckadent-latest-replay';

export interface ReplayRecord {
  version: string;
  /** Unix ms timestamp when the replay was saved. */
  timestamp: number;
  /** Seed passed to createInitialGameState. */
  initialSeed: number;
  /** Ordered list of all accepted commands (the authoritative log). */
  commands: Command[];
  /** gs.tick at the moment saveReplay was called. Required for hash verification. */
  finalTick: number;
  /** hashHex(gs) at finalTick. */
  finalHash: string;
  /** 'win' | 'lose' at save time. */
  outcome: string;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save the current game's command log, tick, and final hash to localStorage.
 * Called once when gs.status transitions to 'win' or 'lose'.
 */
export function saveReplay(gs: GameState): void {
  const record: ReplayRecord = {
    version: REPLAY_VERSION,
    timestamp: Date.now(),
    initialSeed: gs.initialSeed,
    commands: [...getCommandLog()],
    finalTick: gs.tick,
    finalHash: hashHex(gs),
    outcome: gs.status,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    console.info(
      `[Replay] Saved. seed=0x${gs.initialSeed.toString(16)} ` +
      `finalTick=${record.finalTick} hash=${record.finalHash} ` +
      `outcome=${record.outcome} commands=${record.commands.length}`
    );
  } catch (e) {
    console.warn('[Replay] Failed to save to localStorage:', e);
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export function loadLatestReplay(): ReplayRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as ReplayRecord;
    if (rec.version !== REPLAY_VERSION) {
      console.warn(
        `[Replay] Version mismatch: got "${rec.version}", expected "${REPLAY_VERSION}". ` +
        `Play a new game to generate a v2 replay record.`
      );
      return null;
    }
    if (typeof rec.finalTick !== 'number') {
      console.warn('[Replay] Record missing finalTick — cannot verify. Play a new game.');
      return null;
    }
    return rec;
  } catch (e) {
    console.warn('[Replay] Failed to load from localStorage:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Re-simulate a replay record from scratch and compare the final hash.
 *
 * Tick order (must match main.ts exactly):
 *   gs.tick++  →  updateCombatEffects  →  updateCreatureMovement  →  updateSim  →  resolveSimDamage
 *
 * Algorithm:
 *   1. Reset UID counter; create a fresh game state from initialSeed.
 *   2. For each command, fast-forward gs.tick to cmd.tick using the per-tick
 *      order above, then apply with skipTickCheck=true and logCommand=false.
 *   3. After the last command, continue simulating until gs.tick === record.finalTick.
 *   4. Compare hashHex(gs) to record.finalHash.
 *
 * IMPORTANT: verifyReplay must NOT run concurrently with a live game in the
 * same JS context — it resets the module-level UID counter in state.ts.
 * It deliberately avoids writing to the shared command log (logCommand=false).
 */
export interface VerifyResult {
  ok: boolean;
  expectedHash: string;
  gotHash: string;
  finalTick: number;
  ticksRun: number;
  commandsApplied: number;
  commandsRejected: number;
}

/** Advance gs by exactly one tick using the canonical per-tick order. */
function advanceTick(gs: GameState): void {
  gs.tick++;
  updateCombatEffects(gs);
  updateCreatureMovement(gs);
  updateSim(gs.sim);
  resolveSimDamage(gs);
}

export function verifyReplay(record: ReplayRecord): VerifyResult {
  // Fresh state — UID counter reset inside createInitialGameState.
  resetUidCounter();
  clearCommandLog();
  const gs = createInitialGameState(record.initialSeed);

  let commandsApplied = 0;
  let commandsRejected = 0;

  for (const cmd of record.commands) {
    // Fast-forward the simulation to the command's tick.
    while (gs.tick < cmd.tick) advanceTick(gs);
    // Apply with skipTickCheck=true (already at cmd.tick) and logCommand=false
    // so this replay run does not pollute the live game's command log.
    const ok = applyCommand(gs, cmd, { skipTickCheck: true, logCommand: false });
    if (ok) commandsApplied++; else commandsRejected++;
  }

  // Advance to the exact tick at which finalHash was captured.
  while (gs.tick < record.finalTick) advanceTick(gs);

  const gotHash = hashHex(gs);
  const ok = gotHash === record.finalHash;

  console.info(
    `[Replay] Verify ${ok ? 'PASS ✓' : 'FAIL ✗'} ` +
    `expected=${record.finalHash} got=${gotHash} ` +
    `finalTick=${record.finalTick} ticksRun=${gs.tick} ` +
    `cmds=${commandsApplied}/${record.commands.length}`
  );

  return {
    ok,
    expectedHash: record.finalHash,
    gotHash,
    finalTick: record.finalTick,
    ticksRun: gs.tick,
    commandsApplied,
    commandsRejected,
  };
}
