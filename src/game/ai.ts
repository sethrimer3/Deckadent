import type { GameState } from './types';
import type { Command } from './commands';
import { CARD_DEFS } from './cards';
import { applyCommand } from './commands';
import { canCreatureAttack } from './rules';
import { overlapsExistingUnit } from './footprint';
import { SIM_H } from './sandSim';

// ---------------------------------------------------------------------------
// AI command builder — computes the next single AI action as a Command.
// Returns null when the AI has nothing left to do (all actions exhausted).
// Using lazy computation rather than pre-planning so the command always
// reflects fresh game state at the moment of execution.
// ---------------------------------------------------------------------------

function computeNextAICommand(gs: GameState): Command | null {
  const eps = gs.enemy;
  const pps = gs.player;

  const allUnits = [
    ...gs.player.generators, ...gs.player.creatures,
    ...gs.enemy.generators,  ...gs.enemy.creatures,
  ];

  // 1. Play a generator if below 2 and can afford it
  if (eps.generators.length < 2) {
    for (const card of eps.hand) {
      const def = CARD_DEFS[card.defId];
      if (def.type === 'GENERATOR' && def.cost <= eps.energy) {
        const idx = eps.generators.length;
        // Try candidate positions, stepping right until a free spot is found.
        let cx = 100 + idx * 50;
        for (let tries = 0; tries < 10; tries++, cx += 15) {
          if (!overlapsExistingUnit(allUnits, cx, 32)) break;
        }
        return { kind: 'playCard', tick: gs.tick, owner: 'enemy', cardUid: card.uid, placement: { x: cx, y: 32 } };
      }
    }
  }

  // 2. Play creatures — scan a grid of candidate positions in the upper half.
  //    Pre-check overlap so a rejected placement never causes a retry loop.
  for (const card of eps.hand) {
    const def = CARD_DEFS[card.defId];
    if (def.type === 'CREATURE' && def.cost <= eps.energy) {
      let placement: { x: number; y: number } | null = null;
      outer: for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          const cx = 60 + col * 40;
          const cy = 32 + row * 20;
          if (cy >= SIM_H / 2) break outer;
          if (!overlapsExistingUnit(allUnits, cx, cy)) {
            placement = { x: cx, y: cy };
            break outer;
          }
        }
      }
      if (placement) {
        return { kind: 'playCard', tick: gs.tick, owner: 'enemy', cardUid: card.uid, placement };
      }
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

  // 4. Attack with each ready creature — only emit commands for legal (in-range) attacks.
  //    If a creature has no legal target yet, skip it rather than issuing a rejected command
  //    that would cause the AI loop to stall on the same creature indefinitely.
  for (const creature of eps.creatures) {
    if (creature.hasAttacked) continue;

    // Prefer unit targets; check range before building the command.
    const unitTarget =
      pps.creatures.find(t => canCreatureAttack(gs, creature, t.uid)) ??
      pps.generators.find(t => canCreatureAttack(gs, creature, t.uid));

    if (unitTarget) {
      return {
        kind: 'attackTarget', tick: gs.tick, owner: 'enemy',
        attackerUid: creature.uid, targetUid: unitTarget.uid,
      };
    }

    // Fall back to base attack if in range.
    if (canCreatureAttack(gs, creature, undefined, 'player')) {
      return {
        kind: 'attackTarget', tick: gs.tick, owner: 'enemy',
        attackerUid: creature.uid, targetBase: 'player',
      };
    }

    // No legal attack for this creature right now — skip it.
    // We do NOT mark hasAttacked; the creature will try again next turn once
    // it has marched closer to the opponent.
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
  let steps = 0;

  function step(): void {
    if (gs.status !== 'playing') {
      gs.aiActing = false;
      onDone();
      return;
    }

    // Safety guard: if the AI somehow loops (e.g. repeated rejected commands),
    // force an end turn rather than hanging the game indefinitely.
    if (++steps > 40) {
      gs.combatLog.push('[AI] Safety guard triggered — ending turn.');
      applyCommand(gs, { kind: 'endTurn', tick: gs.tick, owner: 'enemy' });
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

    const applied = applyCommand(gs, cmd);
    renderFn();

    // If a command was rejected unexpectedly (should be rare after AI pre-validation),
    // log it for debugging and force end turn to avoid getting stuck.
    if (!applied && cmd.kind !== 'endTurn') {
      gs.combatLog.push(`[AI] Command rejected (${cmd.kind}) — ending turn.`);
      applyCommand(gs, { kind: 'endTurn', tick: gs.tick, owner: 'enemy' });
      gs.aiActing = false;
      onDone();
      return;
    }

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
