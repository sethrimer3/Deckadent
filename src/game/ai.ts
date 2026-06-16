import type { GameState } from './types';
import { CARD_DEFS } from './cards';
import { playCard, attackTarget, endTurn } from './rules';

type AIStep =
  | { kind: 'play'; cardUid: string; targetUid?: string }
  | { kind: 'attack'; attackerUid: string; targetUid: string }
  | { kind: 'end' };

function buildSteps(gs: GameState): AIStep[] {
  const steps: AIStep[] = [];
  const eps = gs.enemy;
  const pps = gs.player;

  let energy = eps.energy;
  const used = new Set<string>();

  // 1. Play generators if we have fewer than 2
  if (eps.generators.length < 2) {
    for (const card of eps.hand) {
      if (used.has(card.uid)) continue;
      const def = CARD_DEFS[card.defId];
      if (def.type === 'GENERATOR' && def.cost <= energy) {
        steps.push({ kind: 'play', cardUid: card.uid });
        energy -= def.cost;
        used.add(card.uid);
        break;
      }
    }
  }

  // 2. Play creatures
  for (const card of eps.hand) {
    if (used.has(card.uid)) continue;
    const def = CARD_DEFS[card.defId];
    if (def.type === 'CREATURE' && def.cost <= energy) {
      steps.push({ kind: 'play', cardUid: card.uid });
      energy -= def.cost;
      used.add(card.uid);
    }
  }

  // 3. Cast spells at player creatures (prefer) else generators
  for (const card of eps.hand) {
    if (used.has(card.uid)) continue;
    const def = CARD_DEFS[card.defId];
    if (def.type === 'SPELL' && def.cost <= energy) {
      const target = pps.creatures[0] ?? pps.generators[0];
      if (target) {
        steps.push({ kind: 'play', cardUid: card.uid, targetUid: target.uid });
        energy -= def.cost;
        used.add(card.uid);
      }
    }
  }

  // 4. Attack with all ready creatures
  for (const creature of eps.creatures) {
    if (creature.hasAttacked) continue;
    const target = pps.creatures[0] ?? pps.generators[0];
    if (target) {
      steps.push({ kind: 'attack', attackerUid: creature.uid, targetUid: target.uid });
    }
  }

  steps.push({ kind: 'end' });
  return steps;
}

export function runEnemyTurn(
  gs: GameState,
  renderFn: () => void,
  onDone: () => void
): void {
  gs.aiActing = true;
  const steps = buildSteps(gs);

  function executeNext(i: number): void {
    if (i >= steps.length || gs.status !== 'playing') {
      gs.aiActing = false;
      onDone();
      return;
    }
    const step = steps[i];

    if (step.kind === 'play') {
      // Re-resolve spell target in case earlier actions changed the board
      if (step.targetUid) {
        const pps = gs.player;
        const freshTarget = pps.creatures[0] ?? pps.generators[0];
        step.targetUid = freshTarget?.uid;
      }
      if (!step.targetUid && CARD_DEFS[gs.enemy.hand.find(c => c.uid === step.cardUid)?.defId ?? '']?.type === 'SPELL') {
        // No valid target; skip
        executeNext(i + 1);
        return;
      }
      playCard(gs, step.cardUid, step.targetUid);
    } else if (step.kind === 'attack') {
      // Re-resolve target
      const pps = gs.player;
      const freshTarget = pps.creatures[0] ?? pps.generators[0];
      if (freshTarget) {
        attackTarget(gs, step.attackerUid, freshTarget.uid);
      }
    } else {
      endTurn(gs);
      gs.aiActing = false;
      renderFn();
      onDone();
      return;
    }

    renderFn();
    setTimeout(() => executeNext(i + 1), 700);
  }

  setTimeout(() => executeNext(0), 400);
}
