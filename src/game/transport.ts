import type { Command } from './commands';
import type { ConnectionState } from './types';
import type { MatchSnapshot } from './session';

export interface MatchTransport {
  connect(address?: string): Promise<void>; disconnect(): void; sendCommand(command: Command): void;
  sendSnapshot(snapshot: MatchSnapshot): void; onCommand(handler: (command: Command) => void): void;
  onSnapshot(handler: (snapshot: MatchSnapshot) => void): void; getConnectionState(): ConnectionState;
}
/** Local transport intentionally exercises the same callback shape as networking. */
export class LocalTransport implements MatchTransport {
  private state: ConnectionState = 'connected'; private commandHandler = (_: Command) => {}; private snapshotHandler = (_: MatchSnapshot) => {};
  async connect(): Promise<void> { this.state = 'connected'; } disconnect(): void { this.state = 'disconnected'; }
  sendCommand(command: Command): void { this.commandHandler(command); } sendSnapshot(snapshot: MatchSnapshot): void { this.snapshotHandler(snapshot); }
  onCommand(handler: (command: Command) => void): void { this.commandHandler = handler; } onSnapshot(handler: (snapshot: MatchSnapshot) => void): void { this.snapshotHandler = handler; }
  getConnectionState(): ConnectionState { return this.state; }
}
/** Browser WebSocket client adapter. Electron host server is an explicit future bridge. */
export class LanTransport implements MatchTransport {
  private state: ConnectionState = 'not-connected'; private socket?: WebSocket; private commandHandler = (_: Command) => {}; private snapshotHandler = (_: MatchSnapshot) => {};
  async connect(address?: string): Promise<void> { if (!address) throw new Error('LAN host address required'); this.state = 'joining'; this.socket = new WebSocket(address); this.socket.onopen = () => this.state = 'connected'; this.socket.onclose = () => this.state = 'disconnected'; this.socket.onerror = () => this.state = 'error'; this.socket.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'command') this.commandHandler(m.payload); if (m.type === 'snapshot') this.snapshotHandler(m.payload); }; }
  disconnect(): void { this.socket?.close(); } sendCommand(c: Command): void { this.socket?.send(JSON.stringify({ type: 'command', payload: c })); } sendSnapshot(s: MatchSnapshot): void { this.socket?.send(JSON.stringify({ type: 'snapshot', payload: s })); }
  onCommand(h: (c: Command) => void): void { this.commandHandler = h; } onSnapshot(h: (s: MatchSnapshot) => void): void { this.snapshotHandler = h; } getConnectionState(): ConnectionState { return this.state; }
}
export class OnlineTransport implements MatchTransport { async connect(): Promise<void> { throw new Error('Online play is not implemented'); } disconnect(): void {} sendCommand(): void {} sendSnapshot(): void {} onCommand(): void {} onSnapshot(): void {} getConnectionState(): ConnectionState { return 'not-connected'; } }
