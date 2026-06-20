import type { GameState, Owner, ElementType, EffectKind, CombatEffect } from './types';
import { addParticle, simRand } from './sandSim';
import { newEffectId } from './state';

// ---------------------------------------------------------------------------
// CombatEffect system.
//
// Effects are enqueued by rules.ts when a creature attacks or a spell is cast.
// Each fixed tick, updateCombatEffects spawns a slice of particles into gs.sim
// so damage resolves through physical particle contact (simDamage.ts), not
// through direct HP subtraction.
//
// Duration per kind:
//   beam  — 10 ticks: sparse water stream
//   spray — 8  ticks: fire/spark scatter toward target
//   burst — 6  ticks: heavy sand drop above target, tapering
// ---------------------------------------------------------------------------

const DURATION: Record<EffectKind, number> = { beam: 10, spray: 8, burst: 6 };

export function elementToEffectKind(element: ElementType): EffectKind {
  switch (element) {
    case 'FIRE':    return 'spray';
    case 'WATER':   return 'beam';
    case 'EARTH':   return 'burst';
    case 'NEUTRAL': return 'spray';
  }
}

export function enqueueEffect(
  gs: GameState,
  owner: Owner,
  element: ElementType,
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
): void {
  const kind = elementToEffectKind(element);
  const effect: CombatEffect = {
    id: newEffectId(gs),
    owner,
    element,
    effectKind: kind,
    sourcePos,
    targetPos,
    startTick: gs.tick,
    durationTicks: DURATION[kind],
  };
  gs.combatEffects.push(effect);
}

// ─── Per-tick particle spawners ───────────────────────────────────────────────

function spawnBeamTick(gs: GameState, sx: number, sy: number, tx: number, ty: number): void {
  const sim = gs.sim;
  const dx = tx - sx, dy = ty - sy;
  // Spawn 3 water particles at random points along the beam line this tick.
  for (let k = 0; k < 3; k++) {
    const t = simRand(sim);
    addParticle(sim, Math.round(sx + dx * t), Math.round(sy + dy * t), 'WATER');
  }
  // Splash at target: extra water near the target point.
  addParticle(sim, tx + Math.round((simRand(sim) - 0.5) * 4), ty + Math.round((simRand(sim) - 0.5) * 4), 'WATER');
}

function spawnSprayTick(gs: GameState, sx: number, sy: number, tx: number, ty: number): void {
  const sim = gs.sim;
  const dx = tx - sx, dy = ty - sy;
  // 4 fire/spark particles scattered toward target this tick.
  for (let k = 0; k < 4; k++) {
    const t = simRand(sim) * 0.85 + 0.1;
    const x = Math.round(sx + dx * t + (simRand(sim) - 0.5) * 9);
    const y = Math.round(sy + dy * t + (simRand(sim) - 0.5) * 9);
    addParticle(sim, x, y, simRand(sim) < 0.55 ? 'FIRE' : 'SPARK');
  }
  // Concentrated burst at target on every other tick.
  if (simRand(sim) < 0.6) {
    addParticle(sim, tx + Math.round((simRand(sim) - 0.5) * 6), ty + Math.round((simRand(sim) - 0.5) * 6), 'FIRE');
  }
}

function spawnBurstTick(gs: GameState, tx: number, ty: number, ticksRemaining: number): void {
  const sim = gs.sim;
  // Heavy initial drop, tapering toward end.
  const count = ticksRemaining >= 4 ? 8 : ticksRemaining >= 2 ? 5 : 2;
  for (let k = 0; k < count; k++) {
    const x = tx + Math.round((simRand(sim) - 0.5) * 22);
    const y = ty - 18 - Math.round(simRand(sim) * 14);
    addParticle(sim, x, y, 'SAND');
  }
}

// ─── Main tick update ─────────────────────────────────────────────────────────

/**
 * Advance all active combat effects by one tick.
 * Called every fixed tick from main.ts (before or after updateSim).
 * Spawns particles into gs.sim; damage resolves via simDamage.ts.
 */
export function updateCombatEffects(gs: GameState): void {
  if (gs.combatEffects.length === 0) return;
  const alive: CombatEffect[] = [];
  for (const fx of gs.combatEffects) {
    const elapsed = gs.tick - fx.startTick;
    const remaining = fx.durationTicks - elapsed;
    if (remaining <= 0) continue; // expired — drop it
    const { sourcePos: s, targetPos: t } = fx;
    switch (fx.effectKind) {
      case 'beam':  spawnBeamTick(gs, s.x, s.y, t.x, t.y); break;
      case 'spray': spawnSprayTick(gs, s.x, s.y, t.x, t.y); break;
      case 'burst': spawnBurstTick(gs, t.x, t.y, remaining); break;
    }
    alive.push(fx);
  }
  gs.combatEffects = alive;
}
