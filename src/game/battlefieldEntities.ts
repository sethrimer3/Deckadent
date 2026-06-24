import { CARD_DEFS } from './cards';
import { SIM_W, SIM_H } from './sandSim';
import type { GameState, UnitInstance } from './types';
import { PALETTE } from './visualTheme';

// ---------------------------------------------------------------------------
// Battlefield creature renderer.
//
// Each creature with simX/simY is drawn as a small pixel-art body on the sim
// canvas. These are the physical battlefield entities — the DOM unit cards in
// the sidebar remain for readability but the canvas body is the spatial authority.
// ---------------------------------------------------------------------------

type Pixel = { dx: number; dy: number; color: string };

function px(pixels: Pixel[], dx: number, dy: number, color: string): void {
  pixels.push({ dx, dy, color });
}

// ─── Emberling: small fire creature ──────────────────────────────────────────

function emberlingPixels(): Pixel[] {
  const p: Pixel[] = [];
  // Body
  px(p, 0, 0, PALETTE.emberBright); px(p, -1, 0, PALETTE.ember); px(p, 1, 0, PALETTE.ember);
  px(p, 0, 1, '#dd3300'); px(p, -1, 1, '#cc2200'); px(p, 1, 1, '#cc2200');
  px(p, 0, -1, '#ff9944'); px(p, -1, -1, '#ff8800');  px(p, 1, -1, '#ff8800');
  // Flame tips
  px(p, 0, -2, '#ffcc44'); px(p, -1, -2, '#ffaa22'); px(p, 1, -2, '#ffaa22');
  px(p, 0, -3, PALETTE.brightGold);
  // Eyes
  px(p, -1, 0, '#222200'); px(p, 1, 0, '#222200');
  return p;
}

// ─── Water Wisp: small water orb ─────────────────────────────────────────────

function waterWispPixels(): Pixel[] {
  const p: Pixel[] = [];
  // Outer orb
  px(p, 0, -2, '#91a9ae'); px(p, -1, -2, '#718e95'); px(p, 1, -2, '#718e95');
  px(p, -2, -1, '#55aadd'); px(p, 2, -1, '#55aadd');
  px(p, -2, 0, '#4499cc');  px(p, 2, 0, '#4499cc');
  px(p, -2, 1, '#55aadd');  px(p, 2, 1, '#55aadd');
  px(p, 0, 2, '#88ddff');   px(p, -1, 2, '#66bbee'); px(p, 1, 2, '#66bbee');
  // Inner glow
  px(p, 0, 0, '#b7c3bb'); px(p, -1, 0, '#91a9ae'); px(p, 1, 0, '#91a9ae');
  px(p, 0, -1, '#bbeeFF'); px(p, 0, 1, '#99ccee');
  // Shimmer
  px(p, -1, -1, '#ffffff'); px(p, 1, -1, '#ddeeff');
  return p;
}

// ─── Stone Mite: squat stone crawler ─────────────────────────────────────────

function stoneMitePixels(): Pixel[] {
  const p: Pixel[] = [];
  // Shell
  px(p, -2, 1, '#888070'); px(p, -1, 1, '#9a9080'); px(p, 0, 1, '#9a9080');
  px(p, 1, 1, '#9a9080');  px(p, 2, 1, '#888070');
  px(p, -2, 0, '#7a7268'); px(p, -1, 0, '#8c8478'); px(p, 0, 0, '#8c8478');
  px(p, 1, 0, '#8c8478');  px(p, 2, 0, '#7a7268');
  px(p, -1, -1, '#706860'); px(p, 0, -1, '#7a7268'); px(p, 1, -1, '#706860');
  // Dark crevices
  px(p, -2, -1, '#504848'); px(p, 2, -1, '#504848');
  // Legs
  px(p, -3, 1, '#605858'); px(p, 3, 1, '#605858');
  px(p, -3, 0, '#504848'); px(p, 3, 0, '#504848');
  // Eyes
  px(p, -1, -1, '#ffcc44'); px(p, 1, -1, '#ffcc44');
  return p;
}

function pixelsForCreature(unit: UnitInstance): Pixel[] {
  switch (unit.defId) {
    case 'emberling':   return emberlingPixels();
    case 'water_wisp':  return waterWispPixels();
    case 'stone_mite':  return stoneMitePixels();
    default: {
      // Generic creature: colored 3×3 square
      const def = CARD_DEFS[unit.defId];
      const colors: Record<string, string> = { FIRE: '#ff6600', WATER: '#4499cc', EARTH: '#886644', NEUTRAL: '#888888' };
      const c = colors[def?.element ?? 'NEUTRAL'] ?? '#888';
      const p: Pixel[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) px(p, dx, dy, c);
      return p;
    }
  }
}

function drawHpBar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  hp: number, maxHp: number,
  above: boolean,
): void {
  const barW = 9;
  const barH = 2;
  const x0 = cx - Math.floor(barW / 2);
  const y0 = above ? cy - 6 : cy + 5;
  if (y0 < 0 || y0 + barH >= SIM_H) return;

  const filled = Math.max(0, Math.round((hp / maxHp) * barW));
  const pct = hp / maxHp;
  const color = pct > 0.5 ? PALETTE.mutedGold : pct > 0.25 ? PALETTE.emberBright : PALETTE.bloodRed;

  ctx.fillStyle = '#111';
  ctx.fillRect(x0, y0, barW, barH);
  if (filled > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, filled, barH);
  }
}

function drawCreature(ctx: CanvasRenderingContext2D, unit: UnitInstance): void {
  if (unit.simX === undefined || unit.simY === undefined) return;
  const cx = Math.round(unit.simX);
  const cy = Math.round(unit.simY);

  const pixels = pixelsForCreature(unit);
  ctx.fillStyle = unit.owner === 'player' ? PALETTE.bronze : PALETTE.bloodRed;
  ctx.fillRect(cx - 3, cy + (unit.owner === 'player' ? 4 : -4), 7, 1);
  for (const p of pixels) {
    const x = cx + p.dx;
    const y = cy + p.dy;
    if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) continue;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, 1, 1);
  }

  // HP bar above for enemy units, below for player units (so it faces battlefield center).
  const above = unit.owner === 'enemy';
  drawHpBar(ctx, cx, cy, unit.hp, unit.maxHp, above);
  if (unit.maxCollisionEnergy !== undefined && unit.collisionEnergy !== undefined) {
    drawHpBar(ctx, cx, cy + (above ? 5 : -5), unit.collisionEnergy, unit.maxCollisionEnergy, above);
  }
}

/** Render all creature bodies for both players onto the sim canvas. */
export function renderCreatureEntities(ctx: CanvasRenderingContext2D, gs: GameState): void {
  for (const unit of [...gs.player.creatures, ...gs.enemy.creatures]) {
    drawCreature(ctx, unit);
  }
}

/**
 * Draw battlefield orientation labels and attacker selection indicator.
 * Layered on top of everything else so labels are always readable.
 */
export function drawBattlefieldLabels(ctx: CanvasRenderingContext2D, gs: GameState): void {
  ctx.save();
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Player base label below the fortress HP bar
  const pb = gs.player.base;
  ctx.fillStyle = PALETTE.mutedGold;
  ctx.fillText('YOUR KEEP', pb.simX, pb.simY + 14);

  // Enemy base label above the fortress HP bar
  const eb = gs.enemy.base;
  ctx.fillStyle = PALETTE.bloodRed;
  ctx.textBaseline = 'bottom';
  ctx.fillText('ENEMY KEEP', eb.simX, eb.simY - 14);

  // White selection ring around the selected attacker
  if (gs.selectedAttackerUid) {
    const attacker = gs.player.creatures.find(c => c.uid === gs.selectedAttackerUid);
    if (attacker && attacker.simX !== undefined && attacker.simY !== undefined) {
      const cx = Math.round(attacker.simX);
      const cy = Math.round(attacker.simY);
      ctx.fillStyle = PALETTE.brightGold;
      for (const [x, y, w, h] of [[cx - 6, cy - 6, 4, 1], [cx - 6, cy - 6, 1, 4], [cx + 3, cy - 6, 4, 1], [cx + 6, cy - 6, 1, 4], [cx - 6, cy + 6, 4, 1], [cx - 6, cy + 3, 1, 4], [cx + 3, cy + 6, 4, 1], [cx + 6, cy + 3, 1, 4]]) ctx.fillRect(x, y, w, h);
    }
  }

  ctx.restore();
}
