import type { ConnectionState, GameMode, GameState, MatchRole, Owner, TransportKind } from './types';
import type { Command } from './commands';
import { applyCommand } from './commands';

export interface MatchSnapshot { protocolVersion: string; tick: number; gameMode: GameMode; state: GameState; }
export interface MultiplayerSession {
  mode: GameMode; transport: TransportKind; role: MatchRole;
  localSeats: Owner[]; remoteSeat?: Owner; connectionState: ConnectionState;
  roomAddress?: string; commandQueue: Command[]; lastConfirmedTick: number; latencyMs?: number;
  nextSequence: number;
}
export const PROTOCOL_VERSION = 'deckadent-protocol-v1';

export function createSession(mode: GameMode): MultiplayerSession {
  const lan = mode === 'realtime-lan-host' || mode === 'realtime-lan-client';
  return { mode, transport: lan ? 'lan' : mode === 'online-placeholder' ? 'online' : 'local',
    role: mode === 'realtime-lan-client' ? 'client' : mode === 'realtime-lan-host' ? 'host' : 'local-both',
    localSeats: mode === 'realtime-lan-host' ? ['player'] : mode === 'realtime-lan-client' ? ['enemy'] : ['player', 'enemy'],
    remoteSeat: lan ? (mode === 'realtime-lan-host' ? 'enemy' : 'player') : undefined,
    connectionState: mode === 'realtime-lan-host' ? 'hosting' : mode === 'realtime-lan-client' ? 'joining' : 'connected',
    commandQueue: [], lastConfirmedTick: 0, nextSequence: 1 };
}

export function snapshotFor(gs: GameState): MatchSnapshot {
  return { protocolVersion: PROTOCOL_VERSION, tick: gs.tick, gameMode: gs.gameMode, state: structuredClone(gs) };
}
export function restoreSnapshot(snapshot: MatchSnapshot): GameState | null {
  if (snapshot.protocolVersion !== PROTOCOL_VERSION || snapshot.tick !== snapshot.state.tick) return null;
  return structuredClone(snapshot.state);
}
/** The only UI-facing command path. LAN clients queue/send; hosts validate. */
export function submitCommand(gs: GameState, session: MultiplayerSession, command: Omit<Command, 'sequence' | 'source'> & Partial<Pick<Command, 'sequence' | 'source'>>): boolean {
  const cmd = { ...command, sequence: command.sequence ?? session.nextSequence++, source: command.source ?? 'local' } as Command;
  if (!session.localSeats.includes(cmd.owner) && cmd.source === 'local') return false;
  session.commandQueue.push(cmd);
  // A LAN client never mutates its mirrored state. The transport delivers this to host.
  if (session.role === 'client') return false;
  const ok = applyCommand(gs, cmd);
  if (ok) session.lastConfirmedTick = gs.tick;
  return ok;
}
