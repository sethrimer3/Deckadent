import { checkWinLoss, destroyDeadUnits } from './rules';
import { damageGeneratorCells, countGeneratorCells } from './generatorShapes';
import { syncGeneratorHealth } from './buildingDamage';
import { MaterialType } from './materials';
import { isGeneratorOperational, createInitialGameState, countCoreCells, resetUidCounter } from './state';
import { resolveSimDamage } from './simDamage';
import type { GameState, ParticleType } from './types';
import { findAttachedBody, isPhysicallyAlive } from './physicalIntegrity';

// Deterministic, framework-free coverage for the physical building-damage contract.
// Kept as an exported harness so it can be invoked by a future test runner without
// adding runtime dependencies to the Electron/Vite app.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Building damage harness: ${message}`);
}

function freshState(): GameState {
  resetUidCounter();
  return createInitialGameState(0x51A7E);
}

function surroundCoreWith(gs: GameState, type: ParticleType): void {
  for (const base of [gs.player.base, gs.enemy.base]) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
      const x = base.simX + dx;
      const y = base.simY + dy;
      const i = y * gs.sim.width + x;
      if (gs.sim.grid[i].type !== 'CORE') gs.sim.grid[i] = { type, lifetime: 999, material: type === 'WATER' ? MaterialType.WATER : MaterialType.FIRE };
    }
  }
}

function resolveUntilCoreDamaged(gs: GameState, type: 'FIRE' | 'WATER'): void {
  const before = countCoreCells(gs.sim, gs.enemy.base);
  surroundCoreWith(gs, type);
  for (let tick = 30; tick <= 1200; tick += 30) {
    gs.tick = tick;
    resolveSimDamage(gs);
    if (countCoreCells(gs.sim, gs.enemy.base) < before) return;
  }
  throw new Error(`${type} did not erode an enemy core cell`);
}

export function runBuildingDamageHarness(): void {
  const gs = freshState();
  const generator = gs.player.generators[0];
  const fullCells = countGeneratorCells(gs.sim, generator.uid);
  assert(generator.originalParticleCount === fullCells && generator.hp === fullCells && generator.maxHp === fullCells, 'generator original particle count must equal placed cells');

  // The creature-collision helper removes a physical cell before synchronization.
  damageGeneratorCells(gs.sim, generator.uid, 1);
  syncGeneratorHealth(gs);
  assert(generator.hp === fullCells - 1, 'physical cell loss must reduce generator HP');

  damageGeneratorCells(gs.sim, generator.uid, Math.ceil(generator.maxHp * 0.41));
  syncGeneratorHealth(gs);
  assert(!isGeneratorOperational(generator), 'generator must become inert below 60% physical health');
  assert(gs.combatLog.some(entry => entry.includes('is disabled at')), 'integrity threshold must produce one combat-log message');

  damageGeneratorCells(gs.sim, generator.uid, generator.maxHp);
  syncGeneratorHealth(gs);
  destroyDeadUnits(gs);
  assert(!gs.player.generators.some(unit => unit.uid === generator.uid), 'zero-cell generator must be removed');
  assert(!gs.sim.grid.some(cell => cell.structureUid === generator.uid), 'generator removal must clear orphaned cells');

  // Connected component authority: the anchor component lives; detached chunks
  // are excluded and default behavior clears them as dead physical debris.
  const splitState = freshState();
  const splitGen = splitState.player.generators[0];
  const ax = splitGen.simX!, ay = splitGen.simY!;
  for (let i = 0; i < splitState.sim.grid.length; i++) if (splitState.sim.grid[i].structureUid === splitGen.uid)
    splitState.sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  for (const [x, y] of [[ax, ay], [ax + 1, ay], [ax + 20, ay], [ax + 21, ay], [ax + 22, ay]])
    splitState.sim.grid[y * splitState.sim.width + x] = { type: 'WALL', lifetime: 1, material: MaterialType.STONE, structureUid: splitGen.uid };
  splitGen.originalParticleCount = 5;
  splitGen.maxHp = 5;
  syncGeneratorHealth(splitState);
  assert(splitGen.survivingParticleCount === 2, 'only the anchored generator component may count as alive');
  assert(!splitState.sim.grid.some(cell => cell.structureUid === splitGen.uid && cell.type !== 'EMPTY' && cell !== splitState.sim.grid[ay * splitState.sim.width + ax] && cell !== splitState.sim.grid[ay * splitState.sim.width + ax + 1]), 'default split behavior must clear detached pieces');
  assert(isPhysicallyAlive(splitGen.hp, splitGen.originalParticleCount!), 'the anchored component remains physically alive');
  splitState.sim.grid[ay * splitState.sim.width + ax + 1] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  syncGeneratorHealth(splitState);
  destroyDeadUnits(splitState);
  assert(!splitState.player.generators.some(unit => unit.uid === splitGen.uid), 'integrity at exactly 20% must destroy a generator');

  // Explicit future split policy preserves detached visuals but never silently
  // counts them toward the primary body's integrity.
  const debrisState = freshState();
  const debrisGen = debrisState.player.generators[0];
  debrisGen.splitBehavior = 'debris';
  const dx = debrisGen.simX!, dy = debrisGen.simY!;
  for (let i = 0; i < debrisState.sim.grid.length; i++) if (debrisState.sim.grid[i].structureUid === debrisGen.uid)
    debrisState.sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  for (const [x, y] of [[dx, dy], [dx + 12, dy]]) debrisState.sim.grid[y * debrisState.sim.width + x] = { type: 'WALL', lifetime: 1, material: MaterialType.STONE, structureUid: debrisGen.uid };
  debrisGen.originalParticleCount = 2;
  syncGeneratorHealth(debrisState);
  assert(debrisGen.hp === 1 && debrisState.sim.grid[dy * debrisState.sim.width + dx + 12].structureUid === debrisGen.uid, 'explicit debris behavior preserves detached cells while excluding them from integrity');

  // With no anchor cell, the largest component wins; equal sizes break by
  // row-major grid order, so selection remains replay-stable.
  const body = findAttachedBody(debrisState.sim, i => debrisState.sim.grid[i].structureUid === debrisGen.uid, undefined, undefined);
  assert(body.attachedIndices[0] === dy * debrisState.sim.width + dx, 'anchorless component tie-break must use stable grid order');

  const coreState = freshState();
  const base = coreState.player.base;
  for (let i = 0; i < coreState.sim.grid.length; i++) {
    const x = i % coreState.sim.width, y = (i / coreState.sim.width) | 0;
    if (coreState.sim.grid[i].type === 'CORE' && Math.abs(x - base.simX) <= 5 && Math.abs(y - base.simY) <= 5)
      coreState.sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  }
  for (const [x, y] of [[base.simX - 4, base.simY], [base.simX - 3, base.simY], [base.simX + 2, base.simY], [base.simX + 3, base.simY], [base.simX + 4, base.simY]])
    coreState.sim.grid[y * coreState.sim.width + x] = { type: 'CORE', lifetime: 0, material: MaterialType.STONE };
  assert(countCoreCells(coreState.sim, base) === 3, 'when a core anchor is gone, the largest connected component must become the body');

  resolveUntilCoreDamaged(freshState(), 'FIRE');
  resolveUntilCoreDamaged(freshState(), 'WATER');

  const lossState = freshState();
  for (let i = 0; i < lossState.sim.grid.length; i++) {
    const cell = lossState.sim.grid[i];
    const x = i % lossState.sim.width, y = (i / lossState.sim.width) | 0;
    if (cell.type === 'CORE' && Math.abs(x - lossState.player.base.simX) <= 2 && Math.abs(y - lossState.player.base.simY) <= 2)
      lossState.sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  }
  checkWinLoss(lossState);
  assert(lossState.status === 'lose', 'removing player core cells must lose the game');

  const winState = freshState();
  for (let i = 0; i < winState.sim.grid.length; i++) {
    const cell = winState.sim.grid[i];
    const x = i % winState.sim.width, y = (i / winState.sim.width) | 0;
    if (cell.type === 'CORE' && Math.abs(x - winState.enemy.base.simX) <= 2 && Math.abs(y - winState.enemy.base.simY) <= 2)
      winState.sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  }
  checkWinLoss(winState);
  assert(winState.status === 'win', 'removing enemy core cells must win the game');
}
