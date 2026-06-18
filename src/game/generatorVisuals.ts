import { CARD_DEFS } from './cards';
import { SIM_H, SIM_W } from './sandSim';
import type { GameState, UnitInstance } from './types';

type Pixel = { dx: number; dy: number; color: string };

const GOLD = '#ffd740';
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
    setPixel(pixels, tx, -5, LEAF);
    setPixel(pixels, tx - 1, -4, LEAF);
    setPixel(pixels, tx, -4, LEAF);
    setPixel(pixels, tx + 1, -4, LEAF);
    setPixel(pixels, tx, -3, DIRT);
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
  return unit.hp > 0 ? addGoldOutline(base) : base;
}

function drawGenerator(ctx: CanvasRenderingContext2D, unit: UnitInstance, fallbackX: number, fallbackY: number): void {
  const cx = Math.round(unit.simX ?? fallbackX);
  const cy = Math.round(unit.simY ?? fallbackY);
  const pixels = pixelsForGenerator(unit);
  for (const p of pixels) {
    const x = cx + p.dx;
    const y = cy + p.dy;
    if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) continue;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, 1, 1);
  }
}

export function renderGeneratorStructures(ctx: CanvasRenderingContext2D, gs: GameState): void {
  gs.enemy.generators.forEach((unit, index) => drawGenerator(ctx, unit, 222 + index * 34, 32));
  gs.player.generators.forEach((unit, index) => drawGenerator(ctx, unit, 62 + index * 34, 148));
}
