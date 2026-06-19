import type { GameState, Owner } from './types';
import { playCard, attackTarget, endTurn } from './rules';

// ---------------------------------------------------------------------------
// Command types — plain serializable objects, no class instances or functions.
// These are the replay record and the future lockstep exchange format.
// ---------------------------------------------------------------------------

export type Command =
  | {
      kind: 'playCard';
      tick: number;
      owner: Owner;
      cardUid: string;
      targetUid?: string;
      placement?: { x: number; y: number };
    }
  | {
      kind: 'attackTarget';
      tick: number;
      owner: Owner;
      attackerUid: string;
      targetUid: string;
    }
  | {
      kind: 'endTurn';
      tick: number;
      owner: Owner;
    }
  | {
      kind: 'selectTarget';
      tick: number;
      owner: Owner;
      targetUid: string;
    };

// ---------------------------------------------------------------------------
// Command log — the authoritative replay record.
// Only accepted commands are pushed here.
// ---------------------------------------------------------------------------
const _commandLog: Command[] = [];
const _rejectedLog: Array<{ cmd: Command; reason: string }> = [];

export function getCommandLog(): Readonly<Command[]> { return _commandLog; }
export function getRejectedLog(): Readonly<typeof _rejectedLog> { return _rejectedLog; }
export function clearCommandLog(): void { _commandLog.length = 0; _rejectedLog.length = 0; }

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Commands that require cmd.owner to match the active turn player. */
const TURN_SENSITIVE: Command['kind'][] = ['playCard', 'attackTarget', 'endTurn'];

function validate(gs: GameState, cmd: Command): string | null {
  if (gs.status !== 'playing') return 'game is over';
  if (TURN_SENSITIVE.includes(cmd.kind) && cmd.owner !== gs.turn) {
    return `not ${cmd.owner}'s turn (active: ${gs.turn})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// applyCommand — the single authoritative entry point for all gameplay mutations.
//
// Validates the command before applying it. Rejected commands are pushed to
// _rejectedLog and not applied. Only accepted commands go into _commandLog.
// ---------------------------------------------------------------------------
export function applyCommand(gs: GameState, cmd: Command): boolean {
  const err = validate(gs, cmd);
  if (err !== null) {
    _rejectedLog.push({ cmd, reason: err });
    return false;
  }

  let ok = false;
  switch (cmd.kind) {
    case 'playCard':
      ok = playCard(gs, cmd.cardUid, cmd.targetUid, cmd.placement);
      break;
    case 'attackTarget':
      ok = attackTarget(gs, cmd.attackerUid, cmd.targetUid);
      break;
    case 'endTurn':
      endTurn(gs);
      ok = true;
      break;
    case 'selectTarget':
      // UI coordination only — no authoritative state change.
      ok = true;
      break;
  }

  if (ok) {
    _commandLog.push(cmd);
  } else {
    _rejectedLog.push({ cmd, reason: 'action rejected by rules' });
  }
  return ok;
}
