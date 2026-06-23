import type { Owner, SimState } from './types';
import { MaterialType } from './materials';

// ---------------------------------------------------------------------------
// Deterministic structure placement helpers.
//
// All functions write WALL cells directly into the sim grid — no PRNG consumed,
// no Math.random. Because WALL cells are part of the sim grid they are
// automatically covered by the state hash.
//
// Rules:
//   - setWall never overwrites CORE cells.
//   - Out-of-bounds writes are silently skipped.
//   - addParticle (sandSim) also protects WALL cells from being overwritten by
//     flying particles, so structures are physically meaningful.
// ---------------------------------------------------------------------------

// Each wall cell is one physical structure particle; a direct collision removes it.
const WALL_DURABILITY = 1;
// Vine cells are more resilient to physical impacts but burn easily.
const VINE_DURABILITY = 60;

function setWall(sim: SimState, x: number, y: number, owner: Owner, material: MaterialType = MaterialType.STONE): void {
  if (x < 0 || x >= sim.width || y < 0 || y >= sim.height) return;
  const idx = y * sim.width + x;
  if (sim.grid[idx].type === 'CORE') return; // never overwrite the base core
  sim.grid[idx] = { type: 'WALL', lifetime: WALL_DURABILITY, owner, material };
}

function setVine(sim: SimState, x: number, y: number, owner: Owner): void {
  if (x < 0 || x >= sim.width || y < 0 || y >= sim.height) return;
  const idx = y * sim.width + x;
  if (sim.grid[idx].type === 'CORE') return;
  sim.grid[idx] = { type: 'VINE', lifetime: VINE_DURABILITY, owner, material: MaterialType.WOOD };
}

// ─── Primitive shapes ─────────────────────────────────────────────────────────

/**
 * Horizontal or vertical line of WALL cells, centered at (cx, cy).
 * length is the total span (including center); half = floor(length/2).
 */
export function placeWallLine(
  sim: SimState,
  cx: number,
  cy: number,
  length: number,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  owner: Owner = 'player',
): void {
  const half = Math.floor(length / 2);
  for (let i = -half; i <= half; i++) {
    if (orientation === 'horizontal') setWall(sim, cx + i, cy, owner);
    else                              setWall(sim, cx,     cy + i, owner);
  }
}

/**
 * Hollow rectangle of WALL cells centered at (cx, cy) with full width w, height h.
 */
export function placeWallRect(sim: SimState, cx: number, cy: number, w: number, h: number, owner: Owner = 'player'): void {
  const x0 = cx - Math.floor(w / 2);
  const y0 = cy - Math.floor(h / 2);
  for (let i = 0; i <= w; i++) { setWall(sim, x0 + i, y0, owner); setWall(sim, x0 + i, y0 + h, owner); }
  for (let i = 1; i < h; i++) { setWall(sim, x0, y0 + i, owner); setWall(sim, x0 + w, y0 + i, owner); }
}

/**
 * Channel: two parallel horizontal WALL rails separated by `gap` pixels,
 * each `length` wide, centered at (cx, cy).
 * Guides water and sand through the corridor between the rails.
 */
export function placeChannel(sim: SimState, cx: number, cy: number, length: number, gap: number, owner: Owner = 'player'): void {
  const halfGap = Math.floor(gap / 2);
  placeWallLine(sim, cx, cy - halfGap, length, 'horizontal', owner);
  placeWallLine(sim, cx, cy + halfGap, length, 'horizontal', owner);
}

/**
 * Firebreak: wide sparse horizontal line (every other column, 2 rows tall)
 * centered at (cx, cy). Slows fire spread without forming a solid barrier.
 */
export function placeFirebreak(sim: SimState, cx: number, cy: number, width: number, owner: Owner = 'player'): void {
  const half = Math.floor(width / 2);
  for (let i = -half; i <= half; i += 2) {
    setWall(sim, cx + i, cy, owner);
    setWall(sim, cx + i, cy + 1, owner);
  }
}

/**
 * Vine tangle: a dense wall of organic VINE cells that burns from fire.
 * Three rows tall for good coverage, 10 cells wide.
 */
export function placeVineTangle(sim: SimState, cx: number, cy: number, owner: Owner = 'player'): void {
  const half = 5;
  for (let row = -1; row <= 1; row++) {
    for (let i = -half; i <= half; i++) {
      setVine(sim, cx + i, cy + row, owner);
    }
  }
}

// ─── Named-shape dispatch ─────────────────────────────────────────────────────

/**
 * Apply a named structure shape centered at (cx, cy).
 * Returns false if the shape name is unknown.
 */
export function applyStructureShape(sim: SimState, shape: string, cx: number, cy: number, owner: Owner = 'player'): boolean {
  switch (shape) {
    case 'wall_line':   placeWallLine(sim, cx, cy, 12, 'horizontal', owner); return true;
    case 'channel':     placeChannel(sim, cx, cy, 8, 6, owner);              return true;
    case 'firebreak':   placeFirebreak(sim, cx, cy, 16, owner);              return true;
    case 'vine_tangle': placeVineTangle(sim, cx, cy, owner);                 return true;
    default:            return false;
  }
}

/**
 * Approximate half-span radius for a named shape, used for CORE overlap checks
 * and unit proximity checks before placement.
 */
export function structureRadius(shape: string): number {
  switch (shape) {
    case 'wall_line':   return 7;
    case 'channel':     return 6;
    case 'firebreak':   return 9;
    case 'vine_tangle': return 6;
    default:            return 8;
  }
}

/**
 * Returns false if the placement footprint (cx ± radius) would overwrite any
 * CORE cell or extend entirely out of bounds. Does NOT check unit proximity —
 * callers may also call overlapsExistingUnit for that.
 */
export function canPlaceStructure(sim: SimState, cx: number, cy: number, radius: number): boolean {
  if (cx < 0 || cx >= sim.width || cy < 0 || cy >= sim.height) return false;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= sim.width || y < 0 || y >= sim.height) continue;
      const type = sim.grid[y * sim.width + x].type;
      if (type === 'CORE' || type === 'WALL' || type === 'VINE') return false;
    }
  }
  return true;
}
