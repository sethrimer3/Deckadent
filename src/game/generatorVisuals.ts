import { CARD_DEFS } from './cards';
import { SIM_H, SIM_W } from './sandSim';
import type { GameState, UnitInstance, BaseInstance, Owner } from './types';
import { isGeneratorOperational } from './state';
import { PALETTE } from './visualTheme';

// ─── Shared colours ───────────────────────────────────────────────────────────

const GOLD       = PALETTE.mutedGold;
const ROCK       = PALETTE.stone;
const ROCK_DARK  = PALETTE.stoneDark;
const GRASS      = PALETTE.moss;
const LEAF       = '#465034';
const DIRT       = '#8a5a32';
const GLASS      = '#89999a';
const GLASS_DARK = '#46575a';
const LIGHT      = PALETTE.oldParchment;
const BUILDING   = '#d5c69a';
const FIRE_CORE  = PALETTE.emberBright;
const WATER_CORE = PALETTE.waterSlate;

// Base/fortress colours
const FORT_WALL  = '#8c7865';
const FORT_DARK  = '#5a4e40';
const FORT_INNER = '#3a3040';

type Pixel = { dx: number; dy: number; color: string };

function setPixel(pixels: Pixel[], dx: number, dy: number, color: string): void {
  pixels.push({ dx, dy, color });
}

function addGoldOutline(pixels: Pixel[]): Pixel[] {
  const filled = new Set(pixels.map(p => `${p.dx},${p.dy}`));
  const outline = new Map<string, Pixel>();
  for (const p of pixels) {
    for (const [ox, oy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][]) {
      const dx = p.dx + ox;
      const dy = p.dy + oy;
      const key = `${dx},${dy}`;
      if (!filled.has(key) && !outline.has(key)) outline.set(key, { dx, dy, color: GOLD });
    }
  }
  return [...outline.values(), ...pixels];
}

// ─── Generator pixel art ──────────────────────────────────────────────────────

function mountainPixels(coreColor: string): Pixel[] {
  const pixels: Pixel[] = [];
  for (let y = 0; y < 13; y++) {
    const half = Math.max(1, Math.floor((13 - y) * 0.75));
    for (let x = -half; x <= half; x++) {
      const edge = Math.abs(x) === half || y > 10;
      setPixel(pixels, x, y, edge ? ROCK_DARK : ROCK);
    }
  }
  for (let y = 4; y < 11; y++) setPixel(pixels, 0, y, coreColor);
  setPixel(pixels, -1, 8, coreColor);
  setPixel(pixels, 1, 8, coreColor);
  return pixels;
}

function islandPixels(coreColor: string): Pixel[] {
  const pixels: Pixel[] = [];
  for (let y = -1; y <= 4; y++) {
    const half = y < 2 ? 12 : 10 - y;
    for (let x = -half; x <= half; x++) setPixel(pixels, x, y, y <= 0 ? GRASS : DIRT);
  }
  for (let y = 5; y < 11; y++) {
    const half = Math.max(1, 8 - y);
    for (let x = -half; x <= half; x++) setPixel(pixels, x, y, ROCK_DARK);
  }
  for (const tx of [-6, 5]) {
    setPixel(pixels, tx,     -5, LEAF);
    setPixel(pixels, tx - 1, -4, LEAF);
    setPixel(pixels, tx,     -4, LEAF);
    setPixel(pixels, tx + 1, -4, LEAF);
    setPixel(pixels, tx,     -3, DIRT);
  }
  setPixel(pixels, 0, 1, coreColor);
  setPixel(pixels, 1, 1, coreColor);
  setPixel(pixels, 0, 2, coreColor);
  return pixels;
}

function domePixels(coreColor: string): Pixel[] {
  const pixels: Pixel[] = [];
  for (let y = -10; y <= 8; y++) {
    for (let x = -12; x <= 12; x++) {
      const dome = (x * x) / 144 + ((y + 1) * (y + 1)) / 100 <= 1;
      if (!dome || y > 8) continue;
      const shell = (x * x) / 121 + ((y + 1) * (y + 1)) / 81 >= 1 || y === 8;
      if (shell) setPixel(pixels, x, y, GLASS);
      else if ((x + y) % 7 === 0) setPixel(pixels, x, y, GLASS_DARK);
    }
  }
  for (let y = -1; y <= 7; y++) {
    for (let x = -5; x <= 5; x++) setPixel(pixels, x, y, y < 2 ? LIGHT : BUILDING);
  }
  for (let y = 2; y <= 5; y++) setPixel(pixels, 0, y, coreColor);
  return pixels;
}

function pixelsForGenerator(unit: UnitInstance): Pixel[] {
  const core = CARD_DEFS[unit.defId].element === 'WATER' ? WATER_CORE : FIRE_CORE;
  const base = unit.defId === 'spring_core'
    ? islandPixels(core)
    : unit.defId === 'spark_core'
      ? mountainPixels(core)
      : domePixels(core);
  const remainingCount = Math.max(1, Math.ceil(base.length * Math.max(0, unit.hp / unit.maxHp)));
  // Stable spread: damaged generators retain scattered physical pixels instead of vanishing whole.
  const remaining = base.filter((_, index) => (index * 17) % base.length < remainingCount);
  return isGeneratorOperational(unit) ? addGoldOutline(remaining) : remaining;
}

function drawGenerator(
  ctx: CanvasRenderingContext2D,
  unit: UnitInstance,
  fallbackX: number,
  fallbackY: number,
  tick: number,
): void {
  const cx = Math.round(unit.simX ?? fallbackX);
  const cy = Math.round(unit.simY ?? fallbackY);
  const pixels = pixelsForGenerator(unit);
  for (const p of pixels) {
    const x = cx + p.dx;
    const y = cy + (unit.owner === 'enemy' ? -p.dy : p.dy);
    if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, 1, 1);
  }
  if (isGeneratorOperational(unit) && ((tick + cx + cy) % 9 === 0)) { ctx.fillStyle = PALETTE.brightGold; ctx.fillRect(cx + ((tick >> 1) % 5) - 2, cy - 9, 1, 1); }
  if (!isGeneratorOperational(unit)) { ctx.fillStyle = PALETTE.ember; ctx.fillRect(cx, cy + 2, 1, 1); }
}

export function renderGeneratorStructures(ctx: CanvasRenderingContext2D, gs: GameState): void {
  gs.enemy.generators.forEach((unit, index) => drawGenerator(ctx, unit, 222 + index * 34, 32, gs.tick));
  gs.player.generators.forEach((unit, index) => drawGenerator(ctx, unit, 62 + index * 34, 288, gs.tick));
}

// ─── Base / core fortress renderer ───────────────────────────────────────────
//
// Each player's base is drawn as a pixelated fortress outline centered on
// base.simX/simY. The interior is left undrawn so that CORE cells rendered
// by renderSim (teal) are visible through the walls.
// An HP bar is drawn just outside the fortress facing the battlefield.

function drawBaseStructure(ctx: CanvasRenderingContext2D, base: BaseInstance): void {
  const { simX, simY, owner, hp, maxHp } = base;
  const HW = 14; // half-width in sim pixels
  const HH = 8;  // half-height in sim pixels

  const x0 = simX - HW;
  const y0 = simY - HH;
  const x1 = simX + HW;
  const y1 = simY + HH;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) continue;
      const onBorder = x === x0 || x === x1 || y === y0 || y === y1;
      if (!onBorder) continue; // leave interior transparent — core cells show through

      // Battlements on the battlefield-facing edge
      const outerEdge = owner === 'player' ? y === y0 : y === y1;
      if (outerEdge && ((x - x0) % 4) < 2) continue; // alternating gaps

      const color = (x + y) % 9 < 2 ? FORT_DARK : FORT_WALL;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Gold accent corners
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as [number, number][]) {
    if (cx >= 0 && cx < SIM_W && cy >= 0 && cy < SIM_H) {
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx, cy, 1, 1);
    }
  }

  // HP bar — drawn just outside the fortress on the battlefield-facing side
  const hpPct = Math.max(0, hp / maxHp);
  const barColor = hpPct > 0.5 ? '#3c9' : hpPct > 0.25 ? '#fa3' : '#e44';
  const barY = owner === 'player' ? y0 - 3 : y1 + 2;
  const barW = Math.round((HW * 2 + 1) * hpPct);
  if (barY >= 0 && barY < SIM_H) {
    if (barW > 0) {
      ctx.fillStyle = barColor;
      ctx.fillRect(x0, barY, barW, 2);
    }
    if (barW < HW * 2 + 1) {
      ctx.fillStyle = '#1a1520';
      ctx.fillRect(x0 + barW, barY, (HW * 2 + 1) - barW, 2);
    }
  }
}

/** Render base/core fortress structures for both players over the sim canvas. */
export function renderBaseStructures(ctx: CanvasRenderingContext2D, gs: GameState): void {
  drawBaseStructure(ctx, gs.player.base);
  drawBaseStructure(ctx, gs.enemy.base);
}
