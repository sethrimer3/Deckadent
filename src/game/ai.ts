import type { GameState } from './types';
import type { Command } from './commands';
import { CARD_DEFS } from './cards';
import { applyCommand } from './commands';

// ---------------------------------------------------------------------------
// AI command builder — computes the next single AI action as a Command.
// Returns null when the AI has nothing left to do (all actions exhausted).
// Using lazy computation rather than pre-planning so the command always
// reflects fresh game state at the moment of execution.
// ---------------------------------------------------------------------------

function computeNextAICommand(gs: GameState): Command | null {
  const eps = gs.enemy;
  const pps = gs.player;

  // 1. Play a generator if below 2 and can afford it
  if (eps.generators.length < 2) {
    for (const card of eps.hand) {
      const def = CARD_DEFS[card.defId];
      if (def.type === 'GENERATOR' && def.cost <= eps.energy) {
        // Pick a deterministic placement based on current generator count
        const idx = eps.generators.length;
        const placement = { x: 100 + idx * 50, y: 32 };
        return { kind: 'playCard', tick: gs.tick, owner: 'enemy', cardUid: card.uid, placement };
      }
    }
  }

  // 2. Play creatures — deterministic placement in the upper half of the battlefield.
  for (const card of eps.hand) {
    const def = CARD_DEFS[card.defId];
    if (def.type === 'CREATURE' && def.cost <= eps.energy) {
      const idx = eps.creatures.length;
      // Spread across upper half: x in [60..260], y in [32..72]
      const placement = { x: 60 + (idx % 5) * 40, y: 32 + Math.floor(idx / 5) * 20 };
      return { kind: 'playCard', tick: gs.tick, owner: 'enemy', cardUid: card.uid, placement };
    }
  }

  // 3. Cast spells — prefer unit targets; fall back to player base.
  for (const card of eps.hand) {
    const def = CARD_DEFS[card.defId];
    if (def.type === 'SPELL' && def.cost <= eps.energy) {
      const target = pps.creatures[0] ?? pps.generators[0];
      if (target) {
        return { kind: 'playCard', tick: gs.tick, owner: 'enemy', cardUid: card.uid, targetUid: target.uid };
      } else {
        return { kind: 'playCard', tick: gs.tick, owner: 'enemy', cardUid: card.uid, targetBase: 'player' };
      }
    }
  }

  // 4. Attack with each ready creature — prefer unit targets; fall back to player base.
  for (const creature of eps.creatures) {
    if (creature.hasAttacked) continue;
    const target = pps.creatures[0] ?? pps.generators[0];
    if (target) {
      return { kind: 'attackTarget', tick: gs.tick, owner: 'enemy', attackerUid: creature.uid, targetUid: target.uid };
    } else {
      return { kind: 'attackTarget', tick: gs.tick, owner: 'enemy', attackerUid: creature.uid, targetBase: 'player' };
    }
  }

  // 5. No more actions — end turn
  return { kind: 'endTurn', tick: gs.tick, owner: 'enemy' };
}

// ---------------------------------------------------------------------------
// runEnemyTurn — drives the AI turn with visual timing delays.
// Timing delays are purely presentational; they do not affect command contents
// or simulation results. Each step re-queries state so targets are always fresh.
// ---------------------------------------------------------------------------
export function runEnemyTurn(
  gs: GameState,
  renderFn: () => void,
  onDone: () => void
): void {
  gs.aiActing = true;

  function step(): void {
    if (gs.status !== 'playing') {
      gs.aiActing = false;
      onDone();
      return;
    }

    const cmd = computeNextAICommand(gs);
    if (!cmd) {
      gs.aiActing = false;
      onDone();
      return;
    }

    applyCommand(gs, cmd);
    renderFn();

    if (cmd.kind === 'endTurn') {
      gs.aiActing = false;
      onDone();
      return;
    }

    // Visual delay between AI actions — does not affect determinism.
    setTimeout(step, 700);
  }

  setTimeout(step, 400);
}
