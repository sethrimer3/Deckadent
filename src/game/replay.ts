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
// Schema version bump this string any time the format changes incompatibly.
// ---------------------------------------------------------------------------
const REPLAY_VERSION = 'deckadent-replay-v1';
const STORAGE_KEY    = 'deckadent-latest-replay';

export interface ReplayRecord {
  version: string;
  /** Unix ms timestamp when the replay was saved. */
  timestamp: number;
  /** Seed passed to createInitialGameState. */
  initialSeed: number;
  /** Ordered list of all accepted commands (the authoritative log). */
  commands: Command[];
  /** State hash at game end, for verification. */
  finalHash: string;
  /** 'win' | 'lose' at save time. */
  outcome: string;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save the current game's command log and final hash to localStorage.
 * Called once when gs.status transitions to 'win' or 'lose'.
 */
export function saveReplay(gs: GameState): void {
  const record: ReplayRecord = {
    version: REPLAY_VERSION,
    timestamp: Date.now(),
    initialSeed: gs.initialSeed,
    commands: [...getCommandLog()],
    finalHash: hashHex(gs),
    outcome: gs.status,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    console.info(`[Replay] Saved. seed=0x${gs.initialSeed.toString(16)} hash=${record.finalHash} outcome=${record.outcome} commands=${record.commands.length}`);
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
      console.warn(`[Replay] Version mismatch: got ${rec.version}, expected ${REPLAY_VERSION}`);
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
 * Algorithm:
 *   1. Reset UID counter and create a fresh game state from initialSeed.
 *   2. For each command in the log, advance gs.tick to cmd.tick by running
 *      the simulation, then apply the command (skipTickCheck=true so the
 *      validator does not reject commands with tick < gs.tick from fast-forward).
 *   3. After all commands are applied, run the sim to the final tick recorded
 *      in the last command (or the first tick past the last command).
 *   4. Compare hashHex(gs) to record.finalHash.
 *
 * Returns a result object so callers can log or display the outcome.
 *
 * Limitations:
 *   - The module-level UID counter (_uid in state.ts) is reset here, so this
 *     function must not run concurrently with a live game in the same JS context.
 *   - The sim PRNG advances identically only if the same number of ticks run
 *     with the same commands — which is exactly what this function ensures.
 */
export interface VerifyResult {
  ok: boolean;
  expectedHash: string;
  gotHash: string;
  ticksRun: number;
  commandsApplied: number;
  commandsRejected: number;
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
    while (gs.tick < cmd.tick) {
      gs.tick++;
      updateCombatEffects(gs);
      updateCreatureMovement(gs);
      updateSim(gs.sim);
      resolveSimDamage(gs);
    }
    // Apply with skipTickCheck=true because we've already advanced to cmd.tick.
    const ok = applyCommand(gs, cmd, true);
    if (ok) commandsApplied++; else commandsRejected++;
  }

  const gotHash = hashHex(gs);
  const ok = gotHash === record.finalHash;

  console.info(
    `[Replay] Verify ${ok ? 'PASS ✓' : 'FAIL ✗'} ` +
    `expected=${record.finalHash} got=${gotHash} ` +
    `tick=${gs.tick} cmds=${commandsApplied}/${record.commands.length}`
  );

  return {
    ok,
    expectedHash: record.finalHash,
    gotHash,
    ticksRun: gs.tick,
    commandsApplied,
    commandsRejected,
  };
}
