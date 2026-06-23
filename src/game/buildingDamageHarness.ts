import { checkWinLoss, destroyDeadUnits } from './rules';
import { damageGeneratorCells, countGeneratorCells } from './generatorShapes';
import { MaterialType } from './materials';
import { isGeneratorOperational, createInitialGameState, countCoreCells, resetUidCounter } from './state';
import { resolveSimDamage, syncGeneratorHealth } from './simDamage';
import type { GameState, ParticleType } from './types';

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
  assert(generator.hp === fullCells && generator.maxHp === fullCells, 'generator HP must start as physical cell count');

  // Fire/spark and collision paths both remove cells; synchronization reflects it in HP.
  damageGeneratorCells(gs.sim, generator.uid, 1);
  syncGeneratorHealth(gs);
  assert(generator.hp === fullCells - 1, 'physical cell loss must reduce generator HP');

  damageGeneratorCells(gs.sim, generator.uid, Math.ceil(generator.maxHp * 0.41));
  syncGeneratorHealth(gs);
  assert(!isGeneratorOperational(generator), 'generator must become inert below 60% physical health');

  damageGeneratorCells(gs.sim, generator.uid, generator.maxHp);
  syncGeneratorHealth(gs);
  destroyDeadUnits(gs);
  assert(!gs.player.generators.some(unit => unit.uid === generator.uid), 'zero-cell generator must be removed');
  assert(!gs.sim.grid.some(cell => cell.structureUid === generator.uid), 'generator removal must clear orphaned cells');

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
