import { MaterialTable, MaterialType } from './materials';
import type { ParticleType, SimParticle, SimState } from './types';

export interface CellDamageResult {
  destroyed: boolean;
  remainingHp?: number;
}

const M = MaterialType;

const DEFAULT_HP_BY_TYPE: Record<ParticleType, number | undefined> = {
  EMPTY: undefined,
  WATER: undefined,
  FIRE: 1,
  SAND: 2,
  SMOKE: undefined,
  SPARK: 1,
  CORE: 20,
  WALL: 10,
  ICE: 8,
  VINE: 6,
};

const DEFAULT_HP_BY_MATERIAL: Partial<Record<MaterialType, number>> = {
  [M.STONE]: 10,
  [M.STEEL]: 30,
  [M.WOOD]: 6,
  [M.ICE]: 8,
  [M.SAND]: 2,
  [M.CRYSTAL]: 14,
  [M.FLESH]: 6,
};

const HOT_TYPES = new Set<ParticleType>(['FIRE', 'SPARK']);

export function getDefaultCellHp(type: ParticleType, material: MaterialType): number | undefined {
  if (type === 'CORE') return DEFAULT_HP_BY_TYPE.CORE;
  if (type === 'WALL') return DEFAULT_HP_BY_MATERIAL[material] ?? DEFAULT_HP_BY_TYPE.WALL;
  if (type === 'VINE') return DEFAULT_HP_BY_TYPE.VINE;
  if (type === 'ICE') return DEFAULT_HP_BY_TYPE.ICE;
  if (type === 'SAND') return DEFAULT_HP_BY_TYPE.SAND;
  return DEFAULT_HP_BY_TYPE[type];
}

export function createCell(
  type: ParticleType,
  material: MaterialType,
  options: Omit<Partial<SimParticle>, 'type' | 'material' | 'hp' | 'maxHp'> & { hp?: number; maxHp?: number } = {},
): SimParticle {
  const defaultHp = getDefaultCellHp(type, material);
  const maxHp = options.maxHp ?? options.hp ?? defaultHp;
  const hp = options.hp ?? maxHp;
  const cell: SimParticle = { ...options, type, material, lifetime: options.lifetime ?? 0 };
  if (hp !== undefined && maxHp !== undefined) {
    cell.hp = hp;
    cell.maxHp = maxHp;
  }
  return cell;
}

export function ensureCellDurability(cell: SimParticle): SimParticle {
  if (cell.type === 'EMPTY' || (cell.hp !== undefined && cell.maxHp !== undefined)) return cell;
  const maxHp = getDefaultCellHp(cell.type, cell.material);
  return maxHp === undefined ? cell : { ...cell, hp: maxHp, maxHp };
}

function emptyCell(): SimParticle {
  return { type: 'EMPTY', lifetime: 0, material: M.VOID };
}

function smokeCell(lifetime = 25): SimParticle {
  return { type: 'SMOKE', lifetime, material: M.VOID };
}

function waterCell(): SimParticle {
  return { type: 'WATER', lifetime: 0, material: M.WATER };
}

function iceCell(lifetime = 300): SimParticle {
  return createCell('ICE', M.ICE, { lifetime });
}

function fireCell(owner?: SimParticle['owner']): SimParticle {
  return { type: 'FIRE', lifetime: 50, owner, material: M.FIRE };
}

function contactDamage(source: SimParticle, target: SimParticle, sourceWasMoving: boolean): number {
  if (HOT_TYPES.has(source.type)) {
    if (target.material === M.STEEL) return 1;
    if (target.type === 'CORE') return 1;
    if (target.type === 'VINE' || target.material === M.WOOD) return 6;
    return 2;
  }
  if (source.type === 'SAND' && sourceWasMoving) return 1;
  return 0;
}

export function applyCellDamage(
  sim: SimState,
  x: number,
  y: number,
  amount: number,
  _sourceType?: ParticleType,
  _sourceMaterial?: MaterialType,
): CellDamageResult {
  if (amount <= 0 || x < 0 || x >= sim.width || y < 0 || y >= sim.height) return { destroyed: false };
  const idx = y * sim.width + x;
  const target = ensureCellDurability(sim.grid[idx]);
  if (target.hp === undefined || target.maxHp === undefined || !MaterialTable[target.material].destructible) {
    sim.grid[idx] = target;
    return { destroyed: false };
  }
  const hp = target.hp - amount;
  if (hp <= 0) {
    sim.grid[idx] = MaterialTable[target.material].leavesAsh
      ? { type: 'SAND', lifetime: 0, material: M.ASH, color: '#606060' }
      : emptyCell();
    return { destroyed: true, remainingHp: 0 };
  }
  sim.grid[idx] = { ...target, hp };
  return { destroyed: false, remainingHp: hp };
}

export function resolveCellInteraction(
  sim: SimState,
  source: SimParticle,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceWasMoving = true,
): boolean {
  if (targetX < 0 || targetX >= sim.width || targetY < 0 || targetY >= sim.height) return true;
  const targetIndex = targetY * sim.width + targetX;
  const sourceIndex = sourceY * sim.width + sourceX;
  const target = ensureCellDurability(sim.grid[targetIndex]);
  sim.grid[targetIndex] = target;
  const sourceIsInGrid = sourceX >= 0 && sourceX < sim.width && sourceY >= 0 && sourceY < sim.height
    && sim.grid[sourceIndex] === source;
  const sourceIsHot = HOT_TYPES.has(source.type);
  const targetIsHot = HOT_TYPES.has(target.type);

  if ((source.type === 'WATER' && targetIsHot) || (sourceIsHot && target.type === 'WATER')) {
    sim.grid[targetIndex] = smokeCell(sourceIsHot ? 20 : 25);
    if (sourceIsInGrid && sourceIsHot) sim.grid[sourceIndex] = smokeCell(20);
    if (sourceIsInGrid && source.type === 'WATER') sim.grid[sourceIndex] = emptyCell();
    return true;
  }

  if ((source.type === 'WATER' && target.type === 'ICE') || (source.type === 'ICE' && target.type === 'WATER')) {
    const frozen = iceCell();
    if (source.type === 'WATER' && sourceIsInGrid) sim.grid[sourceIndex] = frozen;
    else sim.grid[targetIndex] = frozen;
    return true;
  }

  if (sourceIsHot && target.type === 'ICE') {
    sim.grid[targetIndex] = waterCell();
    if (sourceIsInGrid) sim.grid[sourceIndex] = smokeCell(20);
    return true;
  }

  if (source.type === 'ICE' && targetIsHot) {
    sim.grid[targetIndex] = smokeCell(20);
    if (sourceIsInGrid) sim.grid[sourceIndex] = waterCell();
    return true;
  }

  if (sourceIsHot && (target.type === 'VINE' || target.material === M.WOOD)) {
    sim.grid[targetIndex] = fireCell(target.owner);
    return true;
  }

  const damage = contactDamage(source, target, sourceWasMoving);
  if (damage > 0) {
    applyCellDamage(sim, targetX, targetY, damage, source.type, source.material);
    return true;
  }

  return false;
}
