import { MaterialType } from './materials';
import { createSimState } from './sandSim';
import { hashGameState } from './stateHash';
import { createInitialGameState } from './state';
import { createCell, resolveCellInteraction } from './cellDamage';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Cell damage harness: ${message}`);
}

export function runCellDamageHarness(): void {
  const sim = createSimState(123);
  const stoneIndex = 10 * sim.width + 10;
  const steelIndex = 10 * sim.width + 11;
  sim.grid[stoneIndex] = createCell('WALL', MaterialType.STONE);
  sim.grid[steelIndex] = createCell('WALL', MaterialType.STEEL);
  const fire = createCell('FIRE', MaterialType.FIRE, { lifetime: 50 });

  resolveCellInteraction(sim, fire, -1, -1, 10, 10);
  resolveCellInteraction(sim, fire, -1, -1, 10, 10);
  assert(sim.grid[stoneIndex].type === 'WALL' && sim.grid[stoneIndex].hp === 6, 'fire should damage stone over multiple contacts');

  resolveCellInteraction(sim, fire, -1, -1, 11, 10);
  resolveCellInteraction(sim, fire, -1, -1, 11, 10);
  assert(sim.grid[steelIndex].type === 'WALL' && sim.grid[steelIndex].hp === 28, 'steel should take less fire damage than stone');

  const waterFire = createSimState(124);
  waterFire.grid[1] = createCell('FIRE', MaterialType.FIRE, { lifetime: 50 });
  resolveCellInteraction(waterFire, createCell('WATER', MaterialType.WATER), -1, -1, 1, 0);
  assert(waterFire.grid[1].type === 'SMOKE', 'water should extinguish fire without normal damage');

  const vine = createSimState(125);
  vine.grid[2] = createCell('VINE', MaterialType.WOOD, { owner: 'player' });
  resolveCellInteraction(vine, fire, -1, -1, 2, 0);
  assert(vine.grid[2].type === 'FIRE', 'fire should ignite vine faster than stone');

  const ice = createSimState(126);
  ice.grid[3] = createCell('ICE', MaterialType.ICE, { lifetime: 300 });
  resolveCellInteraction(ice, fire, -1, -1, 3, 0);
  assert(ice.grid[3].type === 'WATER', 'fire should melt ice into water');

  const freeze = createSimState(127);
  freeze.grid[4] = createCell('WATER', MaterialType.WATER);
  resolveCellInteraction(freeze, createCell('ICE', MaterialType.ICE, { lifetime: 300 }), -1, -1, 4, 0);
  assert(freeze.grid[4].type === 'ICE', 'ice should freeze water');

  const gs = createInitialGameState(128);
  const hashBefore = hashGameState(gs);
  const wallIndex = gs.sim.grid.findIndex(cell => cell.type === 'WALL' && cell.hp !== undefined);
  assert(wallIndex >= 0, 'initial state should include durable wall cells');
  gs.sim.grid[wallIndex] = { ...gs.sim.grid[wallIndex], hp: gs.sim.grid[wallIndex].hp! - 1 };
  assert(hashGameState(gs) !== hashBefore, 'state hash should change when cell hp changes');
}
