import { CARD_DEFS } from './cards';
import { SIM_W } from './sandSim';
import { updateCreatureMovement } from './movement';
import { playCard } from './rules';
import { createInitialGameState, createUnitInstance } from './state';
import { hashGameState } from './stateHash';
import type { GameState, Owner, UnitInstance } from './types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Creature collision harness: ${message}`);
}

function emptyCollisionState(): GameState {
  const gs = createInitialGameState(0xC0111DE, 'frozen-hotseat');
  gs.matchPhase = 'planning';
  gs.player.creatures = [];
  gs.enemy.creatures = [];
  return gs;
}

function addCreature(gs: GameState, owner: Owner, defId: string, x: number, y: number): UnitInstance {
  const creature = createUnitInstance(defId, owner, x, y);
  (owner === 'player' ? gs.player : gs.enemy).creatures.push(creature);
  return creature;
}

function runContact(gs: GameState, tick: number): void {
  gs.tick = tick;
  updateCreatureMovement(gs);
}

function assertDamage(defId: string, expectedDamage: number): void {
  const gs = emptyCollisionState();
  const attacker = addCreature(gs, 'player', defId, 130, 200);
  const target = addCreature(gs, 'enemy', 'emberling', 130, 196);
  target.hp = 10;
  target.maxHp = 10;
  const energyBefore = attacker.collisionEnergy!;

  const tick = defId === 'emberling' ? 2 : defId === 'water_wisp' ? 3 : 5;
  runContact(gs, tick);

  assert(target.hp === 10 - expectedDamage, `${defId} should deal ${expectedDamage} collision damage`);
  assert(attacker.collisionEnergy === energyBefore - 1, `${defId} should spend one collision energy`);
  assert(attacker.simY === 200, `${defId} should not pass through a live enemy creature`);
}

export function runCreatureCollisionHarness(): void {
  {
    const gs = emptyCollisionState();
    gs.turn = 'player';
    gs.player.energy = 1;
    gs.player.hand = [{ uid: 'test-emberling', defId: 'emberling' }];
    const ok = playCard(gs, 'test-emberling', undefined, { x: SIM_W / 2, y: 240 });
    assert(ok, 'emberling should be playable from hand');
    const emberling = gs.player.creatures[0];
    assert(emberling.collisionEnergy === CARD_DEFS.emberling.collisionEnergy, 'played emberling should initialize collisionEnergy');
    assert(emberling.maxCollisionEnergy === CARD_DEFS.emberling.collisionEnergy, 'played emberling should initialize maxCollisionEnergy');
  }

  {
    const gs = emptyCollisionState();
    const attacker = addCreature(gs, 'player', 'emberling', 120, 250);
    const target = addCreature(gs, 'enemy', 'water_wisp', 120, 244);
    const hashBefore = hashGameState(gs);

    runContact(gs, 2);

    assert(target.hp === 2, 'player creature should damage enemy creature on contact');
    assert(attacker.collisionEnergy === 2, 'player collision should decrement collisionEnergy');
    assert(attacker.simY === 250, 'player creature should remain blocked while enemy is alive');
    assert(hashGameState(gs) !== hashBefore, 'state hash should change when creature hp/collisionEnergy changes');
  }

  {
    const gs = emptyCollisionState();
    const target = addCreature(gs, 'player', 'water_wisp', 120, 76);
    const attacker = addCreature(gs, 'enemy', 'emberling', 120, 70);

    runContact(gs, 2);

    assert(target.hp === 2, 'enemy creature should damage player creature on contact');
    assert(attacker.collisionEnergy === 2, 'enemy collision should decrement collisionEnergy');
    assert(attacker.simY === 70, 'enemy creature should remain blocked while player creature is alive');
  }

  assertDamage('emberling', 1);
  assertDamage('water_wisp', 1);
  assertDamage('stone_mite', 2);

  {
    const gs = emptyCollisionState();
    const attacker = addCreature(gs, 'player', 'emberling', 140, 220);
    const target = addCreature(gs, 'enemy', 'water_wisp', 140, 214);
    attacker.collisionEnergy = 1;
    attacker.maxCollisionEnergy = 1;
    target.hp = 10;

    runContact(gs, 2);

    assert(!gs.player.creatures.some(unit => unit.uid === attacker.uid), 'creature should dissipate when collisionEnergy reaches 0');
  }

  {
    const gs = emptyCollisionState();
    addCreature(gs, 'player', 'emberling', 150, 220);
    const target = addCreature(gs, 'enemy', 'water_wisp', 150, 214);
    target.hp = 1;

    runContact(gs, 2);

    assert(!gs.enemy.creatures.some(unit => unit.uid === target.uid), 'dead target creatures should be removed');
  }
}
