import type { GameState, Owner } from './types';
import { startTurn } from './state';

export const SIM_TICKS_PER_SECOND = 30;
export const FROZEN_SIMULATION_TICKS = SIM_TICKS_PER_SECOND * 5;

function clearInteraction(gs: GameState): void {
  gs.selectedCardUid = null;
  gs.selectedAttackerUid = null;
  gs.pendingSpellCardUid = null;
  gs.pendingGeneratorCardUid = null;
  gs.pendingCreatureCardUid = null;
  gs.pendingStructureCardUid = null;
  gs.phase = 'main';
}

export function beginFrozenMatch(gs: GameState): void {
  gs.gameMode = 'frozen-hotseat';
  gs.matchPhase = 'planning';
  gs.planningOrder = ['player', 'enemy'];
  gs.planningIndex = 0;
  gs.planningCycle = 1;
  gs.simulationTicksRemaining = 0;
  gs.simFrozen = true;
  gs.turn = 'player';
  clearInteraction(gs);
  gs.combatLog.push('Frozen Turn-Based: Planning — Player 1.');
}

export function canIssueTurnCommand(gs: GameState): boolean {
  return gs.status === 'playing' && (gs.gameMode !== 'frozen-hotseat' || gs.matchPhase === 'planning');
}

/** Ends one planning slot, then either hands over or starts the fixed simulation window. */
export function advancePlanningTurn(gs: GameState): void {
  clearInteraction(gs);
  if (gs.gameMode !== 'frozen-hotseat') {
    gs.turn = gs.turn === 'player' ? 'enemy' : 'player';
    startTurn(gs);
    return;
  }
  gs.planningIndex++;
  if (gs.planningIndex < gs.planningOrder.length) {
    gs.turn = gs.planningOrder[gs.planningIndex];
    startTurn(gs);
    gs.combatLog.push(`Planning — ${gs.turn === 'player' ? 'Player 1' : 'Player 2'}.`);
    return;
  }
  gs.matchPhase = 'simulation';
  gs.simFrozen = false;
  gs.simulationTicksRemaining = FROZEN_SIMULATION_TICKS;
  gs.combatLog.push('Simulation resolving for 5 seconds.');
}

/** Called after each deterministic simulation tick. */
export function advanceSimulationWindow(gs: GameState): boolean {
  if (gs.gameMode !== 'frozen-hotseat' || gs.matchPhase !== 'simulation' || gs.status !== 'playing') return false;
  gs.simulationTicksRemaining--;
  if (gs.simulationTicksRemaining > 0) return false;
  gs.planningCycle++;
  gs.planningOrder = gs.planningCycle % 2 === 1 ? ['player', 'enemy'] : ['enemy', 'player'];
  gs.planningIndex = 0;
  gs.turn = gs.planningOrder[0];
  gs.matchPhase = 'planning';
  gs.simFrozen = true;
  startTurn(gs);
  gs.combatLog.push(`Next planning order: ${ownerLabel(gs.planningOrder[0])} → ${ownerLabel(gs.planningOrder[1])}.`);
  return true;
}

export function ownerLabel(owner: Owner): string { return owner === 'player' ? 'Player 1' : 'Player 2'; }
