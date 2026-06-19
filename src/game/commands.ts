import type { GameState, Owner } from './types';
import { playCard, attackTarget, endTurn } from './rules';

// ---------------------------------------------------------------------------
// Command types
// All commands are plain serializable objects — no functions, no class instances.
// This is the foundation for future lockstep networking and replay.
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
// Command log — kept in memory; will eventually be the replay record.
// ---------------------------------------------------------------------------
const _commandLog: Command[] = [];

export function getCommandLog(): Readonly<Command[]> {
  return _commandLog;
}

export function clearCommandLog(): void {
  _commandLog.length = 0;
}

// ---------------------------------------------------------------------------
// applyCommand — the single authoritative entry point for gameplay mutations.
// UI click handlers should build a Command and call this rather than calling
// rules functions directly. This enables future serialization and replay.
// ---------------------------------------------------------------------------
export function applyCommand(gs: GameState, cmd: Command): boolean {
  _commandLog.push(cmd);
  switch (cmd.kind) {
    case 'playCard':
      return playCard(gs, cmd.cardUid, cmd.targetUid, cmd.placement);
    case 'attackTarget':
      return attackTarget(gs, cmd.attackerUid, cmd.targetUid);
    case 'endTurn':
      endTurn(gs);
      return true;
    case 'selectTarget':
      // selectTarget is a UI coordination command; no authoritative state change yet.
      return true;
    default:
      return false;
  }
}
