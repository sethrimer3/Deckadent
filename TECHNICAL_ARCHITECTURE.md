# Deckadent — Technical Architecture

## Phase 1: Deterministic Foundation

### What was implemented

#### Seeded PRNG (`src/game/prng.ts`)
Mulberry32 — a fast, seedable, integer-based PRNG. State is a plain `{ seed: number }` object, fully JSON-serializable. Exposes `nextFloat`, `nextInt`, `chance`, and `fork`. No `Math.random` in gameplay systems.

Two PRNG instances run in parallel:
- **`gs.prng`** — the gameplay PRNG, stored in `GameState`. Controls deck shuffling and all card-game randomness. Seeded from `Date.now()` at game start (stored in state, so a known seed can reproduce any run).
- **`simPrng`** (in `sandSim.ts`) — the simulation PRNG. Controls all particle physics: falling direction, fire spread, spark ignition, smoke drift. Seeded from `gs.prng.seed + 1` so the two streams are independent. Exposed via `getSimPRNGState/setSimPRNGState` for future serialization alongside the grid.

`Math.random` survives only in the render path for the fire/spark visual flicker jitter in `renderSim`. This is explicitly labeled `// VISUAL-ONLY` and does not affect any authoritative state.

#### Fixed Tick (`gs.tick`)
`GameState.tick` is an integer counter, incremented once per fixed sim step (~30/sec) in the `main.ts` game loop. Rendering still uses `requestAnimationFrame`, but gameplay time is measured in ticks, not milliseconds. This is the foundation for future lockstep: both players run the same tick count and compare state hashes.

#### Command Model (`src/game/commands.ts`)
All meaningful player actions are expressed as plain serializable `Command` objects before being applied to state:

```
playCard   — play any card (creature/generator/spell) with optional targetUid/placement
attackTarget — declare an attack from one creature to a target
endTurn    — end the active player's turn
selectTarget — UI coordination command (no state mutation yet)
```

`applyCommand(gs, cmd)` is the single authoritative entry point. It records commands to an in-memory log (`getCommandLog()`) and delegates to the existing rules functions. The UI click handlers now build commands and call `applyCommand` rather than calling rules functions directly.

#### State Hash (`src/game/stateHash.ts`)
`hashHex(gs)` produces a zero-padded 8-character hex string from a djb2 hash of the authoritative gameplay state (tick, turn, status, energy, hand contents, unit HP/hasAttacked per player, PRNG seed). Displayed in the UI header next to the tick counter. Not cryptographically secure — designed for fast lockstep desync detection.

#### Physical Base Scaffolding (`BaseInstance` in `src/game/types.ts`)
Each `PlayerState` now includes a `base: BaseInstance` — a typed, positioned entity on the battlefield with HP and sim coordinates. Player base sits at y=170, enemy at y=10 (top/bottom of the sim field). Not yet rendered or used in win/loss logic — see TODO comments pointing to `DESIGN_GUIDELINES.md`.

#### Spell Mutation Bug Fix (`src/game/rules.ts`)
Previously, `playCard` would deduct energy and remove the card from hand before validating spell targets. An invalid target (null uid, missing unit) would return `false` after the mutation had already occurred. Fixed by validating target presence before any state mutation: invalid plays now return `false` with zero side effects.

### Current limitations

- The sim PRNG is module-level (not in `GameState`) because the particle grid is also module-level. Future serialization will need to snapshot both.
- Commands are logged in memory and lost on page reload. A replay file format is not yet defined.
- AI still calls `playCard`/`attackTarget`/`endTurn` in `rules.ts` directly rather than through `applyCommand`. Routing AI through commands is the next step.
- Base entities exist as typed state but are not yet rendered on the canvas or wired into damage/win logic.
- No networking. No server authority. Hotseat only.

### Next recommended phase

**Phase 2: Sim authority & base rendering**
1. Render base structures on the canvas (simple colored rectangles with HP bars).
2. Persist sim PRNG state alongside the particle grid (make the sim serializable).
3. Route AI actions through `applyCommand` (unify the command log).
4. Wire particle–unit collision: particles that overlap a unit's `simX/simY` radius reduce its HP (turning the sim into a damage source rather than just visual).
5. Introduce a replay file: write the command log to `localStorage` on game end, add a replay loader in `main.ts`.
