import { CARD_DEFS } from './cards';
import type { Owner, SimState, UnitInstance } from './types';
import { MaterialType } from './materials';

export type StructurePixel = { dx: number; dy: number; color: string };

const ROCK = '#786c6a';
const ROCK_DARK = '#4f484b';
const GRASS = '#3ba65f';
const LEAF = '#2f8c4c';
const DIRT = '#8a5a32';
const GLASS = '#98e6ff';
const GLASS_DARK = '#376477';
const LIGHT = '#d8ffff';
const BUILDING = '#d5c69a';
const FIRE_CORE = '#ff8b2f';
const WATER_CORE = '#5ec8ff';

function add(pixels: StructurePixel[], dx: number, dy: number, color: string): void {
  pixels.push({ dx, dy, color });
}

/** Later detail pixels replace base pixels at the same coordinate. */
function uniquePixels(pixels: StructurePixel[]): StructurePixel[] {
  const unique = new Map<string, StructurePixel>();
  for (const pixel of pixels) unique.set(`${pixel.dx},${pixel.dy}`, pixel);
  return [...unique.values()];
}

function mountain(core: string): StructurePixel[] {
  const pixels: StructurePixel[] = [];
  for (let y = 0; y < 13; y++) {
    const half = Math.max(1, Math.floor((13 - y) * 0.75));
    for (let x = -half; x <= half; x++) add(pixels, x, y, Math.abs(x) === half || y > 10 ? ROCK_DARK : ROCK);
  }
  for (let y = 4; y < 11; y++) add(pixels, 0, y, core);
  add(pixels, -1, 8, core); add(pixels, 1, 8, core);
  return pixels;
}

function island(core: string): StructurePixel[] {
  const pixels: StructurePixel[] = [];
  for (let y = -1; y <= 4; y++) {
    const half = y < 2 ? 12 : 10 - y;
    for (let x = -half; x <= half; x++) add(pixels, x, y, y <= 0 ? GRASS : DIRT);
  }
  for (let y = 5; y < 11; y++) {
    const half = Math.max(1, 8 - y);
    for (let x = -half; x <= half; x++) add(pixels, x, y, ROCK_DARK);
  }
  for (const tx of [-6, 5]) {
    add(pixels, tx, -5, LEAF); add(pixels, tx - 1, -4, LEAF); add(pixels, tx, -4, LEAF); add(pixels, tx + 1, -4, LEAF); add(pixels, tx, -3, DIRT);
  }
  add(pixels, 0, 1, core); add(pixels, 1, 1, core); add(pixels, 0, 2, core);
  return pixels;
}

function dome(core: string): StructurePixel[] {
  const pixels: StructurePixel[] = [];
  for (let y = -10; y <= 8; y++) for (let x = -12; x <= 12; x++) {
    const inside = (x * x) / 144 + ((y + 1) * (y + 1)) / 100 <= 1;
    const shell = (x * x) / 121 + ((y + 1) * (y + 1)) / 81 >= 1 || y === 8;
    if (inside && y <= 8 && shell) add(pixels, x, y, GLASS);
    else if (inside && (x + y) % 7 === 0) add(pixels, x, y, GLASS_DARK);
  }
  for (let y = -1; y <= 7; y++) for (let x = -5; x <= 5; x++) add(pixels, x, y, y < 2 ? LIGHT : BUILDING);
  for (let y = 2; y <= 5; y++) add(pixels, 0, y, core);
  return pixels;
}

export function generatorPixels(unit: UnitInstance): StructurePixel[] {
  const core = CARD_DEFS[unit.defId].element === 'WATER' ? WATER_CORE : FIRE_CORE;
  if (unit.defId === 'spring_core') return uniquePixels(island(core));
  if (unit.defId === 'spark_core') return uniquePixels(mountain(core));
  return uniquePixels(dome(core));
}

/** Write a generator as individual WALL particles. Nothing is a visual-only overlay. */
export function placeGeneratorParticles(sim: SimState, unit: UnitInstance): void {
  if (unit.simX === undefined || unit.simY === undefined) return;
  for (const p of generatorPixels(unit)) {
    const x: number = unit.simX + p.dx;
    const y: number = unit.simY + (unit.owner === 'enemy' ? -p.dy : p.dy);
    if (x < 0 || x >= sim.width || y < 0 || y >= sim.height) continue;
    const i = y * sim.width + x;
    if (sim.grid[i].type === 'CORE') continue;
    sim.grid[i] = { type: 'WALL', lifetime: 1, owner: unit.owner, color: p.color, structureUid: unit.uid, material: MaterialType.STONE };
  }
}

export function canPlaceGeneratorParticles(sim: SimState, unit: UnitInstance): boolean {
  if (unit.simX === undefined || unit.simY === undefined) return false;
  return generatorPixels(unit).every(p => {
    const x = unit.simX! + p.dx;
    const y = unit.simY! + (unit.owner === 'enemy' ? -p.dy : p.dy);
    return x >= 0 && x < sim.width && y >= 0 && y < sim.height
      && sim.grid[y * sim.width + x].type === 'EMPTY';
  });
}

export function clearGeneratorParticles(sim: SimState, uid: string): void {
  for (let i = 0; i < sim.grid.length; i++) {
    if (sim.grid[i].structureUid === uid) sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
  }
}

/** Generators use their physical body as HP so gameplay and the sim cannot diverge. */
export function initializeGeneratorHealth(unit: UnitInstance): void {
  const cells = generatorPixels(unit).length;
  unit.hp = cells;
  unit.maxHp = cells;
}

/** Count surviving physical cells owned by a generator. This is its damage authority. */
export function countGeneratorCells(sim: SimState, uid: string): number {
  let count = 0;
  for (const cell of sim.grid) if (cell.structureUid === uid && cell.type !== 'EMPTY') count++;
  return count;
}

/**
 * Remove generator cells in stable grid order. Used by physical collision effects;
 * callers must synchronize the unit's display HP afterwards.
 */
export function damageGeneratorCells(sim: SimState, uid: string, amount: number): void {
  let remaining = amount;
  for (let i = 0; i < sim.grid.length && remaining > 0; i++) {
    if (sim.grid[i].structureUid !== uid) continue;
    sim.grid[i] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
    remaining--;
  }
}
