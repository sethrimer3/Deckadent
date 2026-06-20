import type { GameState, Owner } from './types';
import { playCard, attackTarget, endTurn } from './rules';
import { SIM_W, SIM_H } from './sandSim';
import { CARD_DEFS } from './cards';

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
      targetBase?: Owner;   // spell targeting a base (mutually exclusive with targetUid)
      placement?: { x: number; y: number };
    }
  | {
      kind: 'attackTarget';
      tick: number;
      owner: Owner;
      attackerUid: string;
      targetUid?: string;   // unit target (mutually exclusive with targetBase)
      targetBase?: Owner;   // base target (mutually exclusive with targetUid)
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

/** The opponent of a given owner. */
function opponent(o: Owner): Owner { return o === 'player' ? 'enemy' : 'player'; }

function validate(gs: GameState, cmd: Command, skipTickCheck = false): string | null {
  if (gs.status !== 'playing') return 'game is over';
  if (TURN_SENSITIVE.includes(cmd.kind) && cmd.owner !== gs.turn) {
    return `not ${cmd.owner}'s turn (active: ${gs.turn})`;
  }
  // Tick validation: commands must be issued for the current tick.
  // This catches stale commands re-applied after the sim has advanced.
  // Replay runs advance gs.tick to cmd.tick before calling applyCommand,
  // so this check is still correct during verified replay.
  if (!skipTickCheck && TURN_SENSITIVE.includes(cmd.kind) && cmd.tick !== gs.tick) {
    return `stale command: tick ${cmd.tick} != current tick ${gs.tick}`;
  }

  if (cmd.kind === 'playCard' && cmd.placement) {
    const { x, y } = cmd.placement;
    if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) {
      return `placement (${x},${y}) out of bounds`;
    }
    const ps = cmd.owner === 'player' ? gs.player : gs.enemy;
    const card = ps.hand.find(c => c.uid === cmd.cardUid);
    if (card) {
      const def = CARD_DEFS[card.defId];
      const halfY = SIM_H / 2;
      if (def.type === 'CREATURE') {
        if (cmd.owner === 'player' && y < halfY) return `player creature must be placed in lower half (y >= ${halfY})`;
        if (cmd.owner === 'enemy'  && y >= halfY) return `enemy creature must be placed in upper half (y < ${halfY})`;
      }
      if (def.type === 'GENERATOR') {
        if (cmd.owner === 'player' && y < halfY) return `player generator must be placed in lower half (y >= ${halfY})`;
        if (cmd.owner === 'enemy'  && y >= halfY) return `enemy generator must be placed in upper half (y < ${halfY})`;
      }
    }
  }

  if (cmd.kind === 'playCard' && cmd.targetBase !== undefined) {
    // Spells may only target the opponent's base.
    if (cmd.targetBase !== opponent(cmd.owner)) {
      return `cannot target own base with a spell`;
    }
  }

  if (cmd.kind === 'attackTarget') {
    if (!cmd.targetUid && !cmd.targetBase) return 'attackTarget needs targetUid or targetBase';
    if (cmd.targetUid && cmd.targetBase) return 'attackTarget cannot have both targetUid and targetBase';
    if (cmd.targetBase !== undefined && cmd.targetBase !== opponent(cmd.owner)) {
      return `cannot attack own base`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// applyCommand — the single authoritative entry point for all gameplay mutations.
//
// Validates the command before applying it. Rejected commands are pushed to
// _rejectedLog and not applied. Only accepted commands go into _commandLog.
//
// opts.skipTickCheck — set true in replay runner (tick already advanced to cmd.tick).
// opts.logCommand   — set false in replay runner to avoid polluting the live log.
// ---------------------------------------------------------------------------
export interface ApplyOptions {
  skipTickCheck?: boolean;
  logCommand?: boolean;
}

export function applyCommand(gs: GameState, cmd: Command, opts: ApplyOptions = {}): boolean {
  const skipTickCheck = opts.skipTickCheck ?? false;
  const logCommand    = opts.logCommand    ?? true;
  const err = validate(gs, cmd, skipTickCheck);
  if (err !== null) {
    _rejectedLog.push({ cmd, reason: err });
    return false;
  }

  let ok = false;
  switch (cmd.kind) {
    case 'playCard':
      ok = playCard(gs, cmd.cardUid, cmd.targetUid, cmd.placement, cmd.targetBase);
      break;
    case 'attackTarget':
      ok = attackTarget(gs, cmd.attackerUid, cmd.targetUid, cmd.targetBase);
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
    if (logCommand) _commandLog.push(cmd);
  } else {
    _rejectedLog.push({ cmd, reason: 'action rejected by rules' });
  }
  return ok;
}
