import { createPRNG, nextFloat, chance } from './prng';
import { MaterialType } from './materials';
import type { SimState, SimParticle, ParticleType } from './types';

export const SIM_W = 320;
export const SIM_H = 320;

const FIRE_MAX = 50;
const SMOKE_MAX = 70;
const SPARK_MAX = 35;
const ICE_MAX   = 300;  // ice persists a long time before melting naturally
const VINE_MAX  = 60;   // vine structure lifetime (burning converts it to FIRE, not EMPTY)

// ---------------------------------------------------------------------------
// Default material for each particle type — used by addParticle and inline
// particle construction. WALL material is set by the placement context (not
// via addParticle, which blocks WALL).
// ---------------------------------------------------------------------------
const TYPE_MATERIAL: Record<ParticleType, MaterialType> = {
  EMPTY: MaterialType.VOID,
  WATER: MaterialType.WATER,
  FIRE:  MaterialType.FIRE,
  SAND:  MaterialType.SAND,
  SMOKE: MaterialType.VOID,  // gaseous — no physical resistance
  SPARK: MaterialType.FIRE,  // hot particle — fire-type material
  CORE:  MaterialType.STONE, // never placed via addParticle, included for completeness
  WALL:  MaterialType.STONE, // never placed via addParticle, included for completeness
  ICE:   MaterialType.ICE,
  VINE:  MaterialType.WOOD,
};

// Convenience shorthands used in step functions
const M = MaterialType;

// ---------------------------------------------------------------------------
// Scratch buffer — per-tick "moved" flags. Not game state; purely algorithmic.
// Allocated once and reused every updateSim call to avoid GC pressure.
// ---------------------------------------------------------------------------
let _movedScratch = new Uint8Array(SIM_W * SIM_H);

function ensureScratch(size: number): Uint8Array {
  if (_movedScratch.length < size) _movedScratch = new Uint8Array(size);
  return _movedScratch;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createSimState(seed: number): SimState {
  const size = SIM_W * SIM_H;
  const grid: SimParticle[] = Array.from(
    { length: size },
    () => ({ type: 'EMPTY', lifetime: 0, material: M.VOID }),
  );
  return { width: SIM_W, height: SIM_H, grid, prng: createPRNG(seed) };
}

export function addParticle(
  sim: SimState,
  x: number,
  y: number,
  type: ParticleType,
  gravity: 1 | -1 = 1,
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= sim.width || yi < 0 || yi >= sim.height) return;
  // CORE and WALL are structural — placed directly, never via addParticle.
  if (type === 'CORE' || type === 'WALL') return;
  const existing = sim.grid[yi * sim.width + xi];
  const material = TYPE_MATERIAL[type];
  if (existing.type !== 'EMPTY') {
    // Effect spawns collide too; they never overwrite an occupied cell.
    resolveCollision(sim, { type, lifetime: 0, gravity, material }, xi, yi);
    return;
  }
  const lt = type === 'FIRE'  ? FIRE_MAX  + nextFloat(sim.prng) * 20
           : type === 'SMOKE' ? SMOKE_MAX + nextFloat(sim.prng) * 20
           : type === 'SPARK' ? SPARK_MAX + nextFloat(sim.prng) * 15
           : type === 'ICE'   ? ICE_MAX   + nextFloat(sim.prng) * 100
           : type === 'VINE'  ? VINE_MAX  + nextFloat(sim.prng) * 20
           : 0;
  sim.grid[yi * sim.width + xi] = { type, lifetime: lt, gravity, material };
}

/** Convenience: random float from the sim PRNG. Used by effects.ts. */
export function simRand(sim: SimState): number {
  return nextFloat(sim.prng);
}

export function updateSim(sim: SimState): void {
  const size = sim.width * sim.height;
  const moved = ensureScratch(size);
  moved.fill(0);

  for (let y = sim.height - 1; y >= 0; y--) {
    const ltr = (y & 1) === 0;
    for (let xi = 0; xi < sim.width; xi++) {
      const x = ltr ? xi : sim.width - 1 - xi;
      const i = y * sim.width + x;
      if (moved[i]) continue;
      const p = sim.grid[i];
      // EMPTY, CORE, and WALL are static — no step needed
      if (p.type === 'EMPTY' || p.type === 'CORE' || p.type === 'WALL') continue;

      switch (p.type) {
        case 'SAND':  stepSand(sim, moved, x, y); break;
        case 'WATER': stepWater(sim, moved, x, y); break;
        case 'FIRE':  stepFire(sim, moved, x, y, p); break;
        case 'SMOKE': stepSmoke(sim, moved, x, y, p); break;
        case 'SPARK': stepSpark(sim, moved, x, y, p); break;
        case 'ICE':   stepIce(sim, moved, x, y, p); break;
        case 'VINE':  stepVine(sim, x, y, p); break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function g(sim: SimState, x: number, y: number): SimParticle {
  if (x < 0 || x >= sim.width || y < 0 || y >= sim.height)
    return { type: 'SAND', lifetime: 0, material: M.STONE }; // treat out-of-bounds as solid
  return sim.grid[y * sim.width + x];
}

function isEmpty(sim: SimState, x: number, y: number): boolean {
  const t = g(sim, x, y).type;
  return t === 'EMPTY';
}

function moveTo(sim: SimState, moved: Uint8Array, x: number, y: number, nx: number, ny: number): void {
  const si = y * sim.width + x;
  const di = ny * sim.width + nx;
  const src = sim.grid[si];
  const dst = sim.grid[di];
  sim.grid[si] = dst;
  sim.grid[di] = src;
  moved[si] = 1;
  moved[di] = 1;
}

/** Every occupied target is a collision. Specific pairs define the outcome;
 * all other material pairs block instead of passing through each other. */
function resolveCollision(sim: SimState, source: SimParticle, x: number, y: number): void {
  const target = g(sim, x, y);
  const isHot = source.type === 'FIRE' || source.type === 'SPARK';

  // Water extinguishes fire/spark → smoke
  const waterHeat = (source.type === 'WATER' && (target.type === 'FIRE' || target.type === 'SPARK'))
    || (isHot && target.type === 'WATER');
  if (waterHeat) {
    sim.grid[y * sim.width + x] = { type: 'SMOKE', lifetime: 25, material: M.VOID };
    return;
  }

  // Fire/spark erodes stone walls
  if (isHot && target.type === 'WALL') {
    const i = y * sim.width + x;
    const durability = target.lifetime - 1;
    // { ...target, lifetime: durability } preserves target.material via spread
    sim.grid[i] = durability <= 0
      ? { type: 'EMPTY', lifetime: 0, material: M.VOID }
      : { ...target, lifetime: durability };
    return;
  }

  // Fire/spark ignites vine → vine becomes fire
  if (isHot && target.type === 'VINE') {
    sim.grid[y * sim.width + x] = { type: 'FIRE', lifetime: FIRE_MAX, owner: target.owner, material: M.FIRE };
    return;
  }

  // Ice melts to water when hit by fire/spark, extinguishing the heat source context
  if (isHot && target.type === 'ICE') {
    sim.grid[y * sim.width + x] = { type: 'WATER', lifetime: 0, material: M.WATER };
    return;
  }

  // Water touching ice freezes to ice (contact freeze)
  if (source.type === 'WATER' && target.type === 'ICE') {
    // source water particle collides into ice — it freezes
    // The source itself will stay where it was (resolveCollision doesn't move source)
    // so we handle this in stepWater instead for adjacency-based freezing.
    return;
  }
}

function tryMove(sim: SimState, moved: Uint8Array, x: number, y: number, nx: number, ny: number): boolean {
  if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) return false;
  const source = sim.grid[y * sim.width + x];
  const target = sim.grid[ny * sim.width + nx];
  if (target.type === 'EMPTY') { moveTo(sim, moved, x, y, nx, ny); return true; }
  // Sand displaces water as its density interaction; neither is overwritten.
  if (source.type === 'SAND' && target.type === 'WATER') { moveTo(sim, moved, x, y, nx, ny); return true; }
  resolveCollision(sim, source, nx, ny);
  return false;
}

// ---------------------------------------------------------------------------
// Step functions
// ---------------------------------------------------------------------------

function stepSand(sim: SimState, moved: Uint8Array, x: number, y: number): void {
  const gravity = sim.grid[y * sim.width + x].gravity ?? 1;
  const nextY = y + gravity;
  if (nextY < 0 || nextY >= sim.height) return;
  if (tryMove(sim, moved, x, y, x, nextY)) return;
  const d = chance(sim.prng, 0.5) ? 1 : -1;
  if (x + d >= 0 && x + d < sim.width) {
    if (tryMove(sim, moved, x, y, x + d, nextY)) return;
  }
  if (x - d >= 0 && x - d < sim.width) {
    tryMove(sim, moved, x, y, x - d, nextY);
  }
}

function stepWater(sim: SimState, moved: Uint8Array, x: number, y: number): void {
  const gravity = sim.grid[y * sim.width + x].gravity ?? 1;
  const nextY = y + gravity;
  if (nextY >= 0 && nextY < sim.height && tryMove(sim, moved, x, y, x, nextY)) return;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
    const neighbor = g(sim, nx, ny);
    // Water extinguishes adjacent fire — special-case high removal probability
    if (neighbor.type === 'FIRE') {
      sim.grid[ny * sim.width + nx] = { type: 'SMOKE', lifetime: 25, material: M.VOID };
      sim.grid[y * sim.width + x]   = { type: 'EMPTY', lifetime: 0, material: M.VOID };
      return;
    }
    // Water adjacent to ICE has a chance to freeze (propagating freeze)
    if (neighbor.type === 'ICE' && chance(sim.prng, 0.04)) {
      sim.grid[y * sim.width + x] = { type: 'ICE', lifetime: ICE_MAX, material: M.ICE };
      return;
    }
  }
  const d = chance(sim.prng, 0.5) ? 1 : -1;
  if (x + d >= 0 && x + d < sim.width && tryMove(sim, moved, x, y, x + d, y)) return;
  if (x - d >= 0 && x - d < sim.width) tryMove(sim, moved, x, y, x - d, y);
}

function stepFire(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  p.lifetime--;
  if (p.lifetime <= 0) {
    sim.grid[y * sim.width + x] = chance(sim.prng, 0.35)
      ? { type: 'SMOKE', lifetime: SMOKE_MAX, material: M.VOID }
      : { type: 'EMPTY', lifetime: 0, material: M.VOID };
    return;
  }
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
    const neighbor = g(sim, nx, ny);
    // Water quenches fire immediately
    if (neighbor.type === 'WATER') {
      sim.grid[y  * sim.width + x]  = { type: 'SMOKE', lifetime: 20, material: M.VOID };
      sim.grid[ny * sim.width + nx] = { type: 'EMPTY', lifetime: 0, material: M.VOID };
      return;
    }
    // Fire aggressively spreads into adjacent vine (high 40% chance each neighbor)
    if (neighbor.type === 'VINE' && chance(sim.prng, 0.40)) {
      sim.grid[ny * sim.width + nx] = { type: 'FIRE', lifetime: FIRE_MAX, owner: neighbor.owner, material: M.FIRE };
    }
    // Fire melts adjacent ice (slower, low chance — heat radiates)
    if (neighbor.type === 'ICE' && chance(sim.prng, 0.08)) {
      sim.grid[ny * sim.width + nx] = { type: 'WATER', lifetime: 0, material: M.WATER };
    }
  }
  if (y - 1 >= 0 && chance(sim.prng, 0.25) && tryMove(sim, moved, x, y, x, y - 1)) {
    return;
  }
  if (chance(sim.prng, 0.06)) {
    const dx = chance(sim.prng, 0.5) ? 1 : -1;
    const nx = x + dx;
    if (nx >= 0 && nx < sim.width && isEmpty(sim, nx, y)) {
      sim.grid[y * sim.width + nx] = { type: 'FIRE', lifetime: Math.round(p.lifetime * 0.4), material: M.FIRE };
    } else if (nx >= 0 && nx < sim.width) {
      resolveCollision(sim, p, nx, y);
    }
  }
}

function stepSmoke(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  p.lifetime--;
  if (p.lifetime <= 0) { sim.grid[y * sim.width + x] = { type: 'EMPTY', lifetime: 0, material: M.VOID }; return; }
  if (y - 1 >= 0 && chance(sim.prng, 0.35) && tryMove(sim, moved, x, y, x, y - 1)) {
    return;
  }
  const d = chance(sim.prng, 0.5) ? 1 : -1;
  if (x + d >= 0 && x + d < sim.width && y - 1 >= 0 && chance(sim.prng, 0.15)) {
    tryMove(sim, moved, x, y, x + d, y - 1);
  }
}

function stepSpark(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  p.lifetime--;
  if (p.lifetime <= 0) { sim.grid[y * sim.width + x] = { type: 'EMPTY', lifetime: 0, material: M.VOID }; return; }
  if (chance(sim.prng, 0.08)) {
    const nx = x + (chance(sim.prng, 0.5) ? 1 : -1);
    const ny = y + (chance(sim.prng, 0.5) ? 1 : -1);
    if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height && isEmpty(sim, nx, ny)) {
      sim.grid[ny * sim.width + nx] = { type: 'FIRE', lifetime: FIRE_MAX, material: M.FIRE };
    } else if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height) {
      resolveCollision(sim, p, nx, ny);
    }
  }
  const dx = chance(sim.prng, 0.5) ? 1 : -1;
  const dy = chance(sim.prng, 0.55) ? -1 : (chance(sim.prng, 0.5) ? 1 : -1);
  const nx = x + dx, ny = y + dy;
  if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height) tryMove(sim, moved, x, y, nx, ny);
}

function stepIce(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  // Natural slow melt over time
  p.lifetime -= 0.5;  // effectively halved decay vs FIRE
  if (p.lifetime <= 0) {
    sim.grid[y * sim.width + x] = { type: 'WATER', lifetime: 0, material: M.WATER };
    return;
  }
  // Melt when adjacent to fire or spark — turns ICE to water and creates steam
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
    const neighbor = g(sim, nx, ny);
    if ((neighbor.type === 'FIRE' || neighbor.type === 'SPARK') && chance(sim.prng, 0.12)) {
      sim.grid[y  * sim.width + x]  = { type: 'WATER', lifetime: 0, material: M.WATER };
      sim.grid[ny * sim.width + nx] = { type: 'SMOKE', lifetime: 20, material: M.VOID };
      return;
    }
    // Propagate freeze to adjacent water (chain-freeze, slow)
    if (neighbor.type === 'WATER' && chance(sim.prng, 0.025)) {
      sim.grid[ny * sim.width + nx] = { type: 'ICE', lifetime: ICE_MAX, material: M.ICE };
    }
  }
  void moved; // suppress unused variable warning — stepIce doesn't move
}

// VINE is a static organic particle that ignites easily near fire.
// Placed by structure cards; never drifts with gravity.
function stepVine(sim: SimState, x: number, y: number, p: SimParticle): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
    const neighbor = g(sim, nx, ny);
    if ((neighbor.type === 'FIRE' || neighbor.type === 'SPARK') && chance(sim.prng, 0.25)) {
      sim.grid[y * sim.width + x] = { type: 'FIRE', lifetime: FIRE_MAX, owner: p.owner, material: M.FIRE };
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering — reads SimState, must not mutate it. Math.random allowed here
// for purely visual effects (fire flicker jitter) that do not affect game state.
// ---------------------------------------------------------------------------

const COLORS: Record<ParticleType, readonly [number, number, number]> = {
  EMPTY: [15, 10, 28],
  WATER: [40, 110, 230],
  FIRE:  [230, 70, 10],
  SAND:  [185, 158, 82],
  SMOKE: [95, 95, 108],
  SPARK: [255, 220, 40],
  CORE:  [0, 210, 160],   // teal — physically significant base/core cells
  WALL:  [120, 105, 80],  // stone grey-brown — player-placed structural barrier
  ICE:   [160, 220, 255], // icy light blue
  VINE:  [35, 110, 35],   // forest green — organic, flammable
};

export function renderSim(ctx: CanvasRenderingContext2D, sim: SimState): void {
  const img = ctx.createImageData(sim.width, sim.height);
  const d = img.data;
  const { grid } = sim;

  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    const pi = i * 4;
    // Cell render color = stored color if present; otherwise particle-type default.
    // Material type is physics-only and does NOT override the visual color.
    const [r, g, b] = p.color ? hexToRgb(p.color) : COLORS[p.type];
    // VISUAL-ONLY: fire/spark flicker and ice shimmer use Math.random — not gameplay-affecting.
    const fireJitter = (p.type === 'FIRE' || p.type === 'SPARK') ? (Math.random() * 30 | 0) : 0;
    const iceJitter  = p.type === 'ICE' ? (Math.random() * 20 | 0) : 0;
    d[pi]     = Math.min(255, r + fireJitter);
    d[pi + 1] = Math.min(255, g + (p.type === 'FIRE' ? fireJitter * 0.5 : 0) + iceJitter);
    d[pi + 2] = Math.min(255, b + iceJitter);
    d[pi + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
