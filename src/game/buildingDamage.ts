import { CARD_DEFS } from './cards';
import { clearGeneratorParticles, countGeneratorCells } from './generatorShapes';
import type { GameState, UnitInstance } from './types';

const OPERATIONAL_INTEGRITY = 0.6;

/** Physical generator cells are authoritative; this only mirrors them into unit HP. */
export function syncGeneratorHp(unit: UnitInstance, gs: GameState): void {
  const wasOperational = unit.maxHp > 0 && unit.hp / unit.maxHp >= OPERATIONAL_INTEGRITY;
  unit.hp = countGeneratorCells(gs.sim, unit.uid);
  const isOperational = unit.hp > 0 && unit.hp / unit.maxHp >= OPERATIONAL_INTEGRITY;
  if (wasOperational && !isOperational && unit.hp > 0) {
    const integrity = Math.round((unit.hp / unit.maxHp) * 100);
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
      if (unit.hp > 0) continue;
      clearGeneratorParticles(gs.sim, unit.uid);
      gs.combatLog.push(`${CARD_DEFS[unit.defId].name} (generator) was destroyed!`);
    }
    ps.generators = ps.generators.filter(unit => unit.hp > 0);
  }
}
