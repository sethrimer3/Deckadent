import { CARD_DEFS } from './cards';
import { clearGeneratorParticles } from './generatorShapes';
import type { GameState, UnitInstance } from './types';
import { findAttachedBody, integrityRatio, isPhysicallyAlive, isOperational, shouldClearDetachedParts } from './physicalIntegrity';
import { MaterialType } from './materials';

/** Physical generator cells are authoritative; hp/maxHp are display compatibility aliases. */
export function syncGeneratorHp(unit: UnitInstance, gs: GameState): void {
  const original = unit.originalParticleCount ?? unit.maxHp;
  const wasOperational = isOperational(unit.survivingParticleCount ?? unit.hp, original);
  const body = findAttachedBody(gs.sim, i => gs.sim.grid[i].structureUid === unit.uid && gs.sim.grid[i].type !== 'EMPTY', unit.anchorX, unit.anchorY);
  if (shouldClearDetachedParts(unit.splitBehavior)) {
    for (const i of body.detachedIndices) gs.sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  }
  unit.survivingParticleCount = body.attachedIndices.length;
  unit.originalParticleCount = original;
  unit.hp = unit.survivingParticleCount;
  unit.maxHp = original;
  const nowOperational = isOperational(unit.hp, original);
  if (wasOperational && !nowOperational && isPhysicallyAlive(unit.hp, original)) {
    const integrity = Math.round(integrityRatio(unit.hp, original) * 100);
    gs.combatLog.push(`${CARD_DEFS[unit.defId].name} is disabled at ${integrity}% integrity.`);
  }
}

export function syncGeneratorHealth(gs: GameState): void {
  for (const unit of [...gs.player.generators, ...gs.enemy.generators]) syncGeneratorHp(unit, gs);
}

/** Shared, idempotent generator cleanup for sim erosion and creature collisions. */
export function destroyDeadGenerators(gs: GameState): void {
  for (const ps of [gs.player, gs.enemy]) {
    for (const unit of ps.generators) {
      if (isPhysicallyAlive(unit.survivingParticleCount ?? unit.hp, unit.originalParticleCount ?? unit.maxHp)) continue;
      clearGeneratorParticles(gs.sim, unit.uid);
      gs.combatLog.push(`${CARD_DEFS[unit.defId].name} (generator) was destroyed!`);
    }
    ps.generators = ps.generators.filter(unit =>
      isPhysicallyAlive(unit.survivingParticleCount ?? unit.hp, unit.originalParticleCount ?? unit.maxHp)
    );
  }
}
