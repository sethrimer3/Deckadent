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

const DURATION: Record<EffectKind, number> = { beam: 14, spray: 12, burst: 8, freeze: 10 };

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
  kindOverride?: EffectKind,
): void {
  const kind = kindOverride ?? elementToEffectKind(element);
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
  const gravity: 1 | -1 = ty < sy ? -1 : 1;
  // 5 water particles along the beam line per tick (was 3).
  for (let k = 0; k < 5; k++) {
    const t = simRand(sim);
    addParticle(sim, Math.round(sx + dx * t), Math.round(sy + dy * t), 'WATER', gravity);
  }
  // Double splash at target for better particle concentration.
  addParticle(sim, tx + Math.round((simRand(sim) - 0.5) * 4), ty + Math.round((simRand(sim) - 0.5) * 4), 'WATER', gravity);
  addParticle(sim, tx + Math.round((simRand(sim) - 0.5) * 3), ty + Math.round((simRand(sim) - 0.5) * 3), 'WATER', gravity);
}

function spawnSprayTick(gs: GameState, sx: number, sy: number, tx: number, ty: number): void {
  const sim = gs.sim;
  const dx = tx - sx, dy = ty - sy;
  // 6 fire/spark particles scattered toward target per tick (was 4).
  for (let k = 0; k < 6; k++) {
    const t = simRand(sim) * 0.85 + 0.1;
    const x = Math.round(sx + dx * t + (simRand(sim) - 0.5) * 9);
    const y = Math.round(sy + dy * t + (simRand(sim) - 0.5) * 9);
    addParticle(sim, x, y, simRand(sim) < 0.55 ? 'FIRE' : 'SPARK');
  }
  // Concentrated burst at target — higher probability and double hit (was single at 60%).
  if (simRand(sim) < 0.8) {
    addParticle(sim, tx + Math.round((simRand(sim) - 0.5) * 6), ty + Math.round((simRand(sim) - 0.5) * 6), 'FIRE');
    addParticle(sim, tx + Math.round((simRand(sim) - 0.5) * 4), ty + Math.round((simRand(sim) - 0.5) * 4), 'SPARK');
  }
}

function spawnBurstTick(gs: GameState, sx: number, sy: number, tx: number, ty: number, ticksRemaining: number): void {
  const sim = gs.sim;
  const gravity: 1 | -1 = ty < sy ? -1 : 1;
  // Heavier initial drop, tapering toward end.
  const count = ticksRemaining >= 6 ? 10 : ticksRemaining >= 4 ? 8 : ticksRemaining >= 2 ? 5 : 3;
  for (let k = 0; k < count; k++) {
    const x = tx + Math.round((simRand(sim) - 0.5) * 22);
    const y = ty - gravity * (18 + Math.round(simRand(sim) * 14));
    addParticle(sim, x, y, 'SAND', gravity);
  }
}

// Freeze beam: fires ICE particles along the beam line and concentrates them at target.
// Ice extinguishes fire, freezes water, and is especially effective vs fire-element units.
function spawnFreezeTick(gs: GameState, sx: number, sy: number, tx: number, ty: number): void {
  const sim = gs.sim;
  const dx = tx - sx, dy = ty - sy;
  const gravity: 1 | -1 = ty < sy ? -1 : 1;
  // 4 ICE particles scattered along the beam
  for (let k = 0; k < 4; k++) {
    const t = simRand(sim);
    addParticle(sim, Math.round(sx + dx * t), Math.round(sy + dy * t), 'ICE', gravity);
  }
  // Dense concentration at target
  for (let k = 0; k < 3; k++) {
    addParticle(
      sim,
      tx + Math.round((simRand(sim) - 0.5) * 6),
      ty + Math.round((simRand(sim) - 0.5) * 6),
      'ICE', gravity,
    );
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
      case 'beam':   spawnBeamTick(gs, s.x, s.y, t.x, t.y); break;
      case 'spray':  spawnSprayTick(gs, s.x, s.y, t.x, t.y); break;
      case 'burst':  spawnBurstTick(gs, s.x, s.y, t.x, t.y, remaining); break;
      case 'freeze': spawnFreezeTick(gs, s.x, s.y, t.x, t.y); break;
    }
    alive.push(fx);
  }
  gs.combatEffects = alive;
}
