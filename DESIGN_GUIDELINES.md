# Deckadent Design Guidelines

Deckadent is intended to become a deterministic, physics-driven, falling-sand-themed card battler. This file records the intended direction before the prototype accumulates too many assumptions that conflict with multiplayer or physical gameplay.

## Core vision

Deckadent should not become a standard card game with particle effects drawn on top. Cards should create, place, modify, protect, or destroy real battlefield objects inside the simulation.

The battlefield is the source of truth. Damage, defense, blocking, terrain, resource structures, and unit interactions should resolve through deterministic simulation state wherever practical.

The deckbuilder layer should provide strategic choices. The physics layer should decide how those choices actually collide, spread, burn, flow, collapse, shield, and destroy structures.

## Target multiplayer modes

The long-term target is to support multiple ways to play:

- Hotseat PvP on the same device.
- LAN PvP.
- Online PvP.
- Potentially single-player against AI, but AI should use the same rules and simulation as a human player.

These targets imply that the simulation must be deterministic from the beginning. Multiplayer support should not be treated as a late retrofit.

## Determinism requirements

All gameplay-relevant simulation must be deterministic across machines and sessions when given the same initial state and same ordered player inputs.

Hard requirements:

- Use a fixed simulation tick.
- Avoid `Math.random()` in gameplay systems.
- Use a seeded deterministic PRNG for all gameplay randomness.
- Keep all gameplay state serializable.
- Do not depend on frame rate, wall-clock timing, animation timing, browser scheduling, GPU state, DOM order, or floating-point chaos for gameplay outcomes.
- Player input should be recorded as discrete commands with tick numbers.
- Multiplayer should eventually be able to use a lockstep model: each client runs the same simulation and exchanges player commands.
- Any visual-only nondeterminism must be isolated from gameplay state.

Softbody or rigidbody-like behavior may exist, but it must be implemented in a deterministic way if it affects gameplay.

## Simulation philosophy

The game may include falling-sand materials, rigid structures, and limited softbody-style entities. The simulation does not need to be scientifically realistic, but it must be readable, deterministic, and tactically meaningful.

Supported interaction categories may eventually include:

- Sand, dirt, stone, water, fire, smoke, acid, steam, sparks, roots, vines, shields, metal, crystal, void, or other card-defined materials.
- Flow, falling, burning, cooling, erosion, melting, pressure, collapse, growth, conductivity, absorption, corruption, or crystallization.
- Softbody circles, blobs, worms, cubes, or other physical creature bodies that roll, crawl, compress, bounce, split, or deform.
- Structures made from simulation cells or bonded particles.
- Projectiles and spells that are real physical events, not just direct HP changes.

Any material or physical object that affects victory, damage, energy generation, board control, unit movement, or targeting must be deterministic.

## Win condition and main base

Each player should start with a castle, fortress, shrine, engine, or other main base structure.

The main base should contain a vulnerable core. The player loses when the core is destroyed, breached, overheated, dissolved, crushed, corrupted, or otherwise damaged beyond its allowed threshold by physical simulation interactions.

The core should not be a detached abstract HP counter if avoidable. It should be represented on the battlefield as actual simulation state. HP-like summaries are allowed for readability, but the authoritative damage should come from the physical state of the core or its core cells.

## Cards as physical actions

Cards should be played onto the battlefield.

A card play should usually include a battlefield placement or target point chosen by the player. Placement must become part of the deterministic command stream.

Card categories:

### Generators

Generators create energy or other resources over time. They are physical structures on the battlefield and can be damaged or destroyed.

Generator output should depend on their physical survival, integrity, exposure, adjacency, fuel, heat, water pressure, connected conduits, or other deterministic simulation conditions where appropriate.

### Creatures

Creatures are physical entities on the battlefield. They should occupy space, collide, move, burn, drown, melt, erode, push, shield, climb, dig, or otherwise interact with the simulation.

Creature damage should come from their physical body state where practical. Some creatures may be softbody-like objects such as rolling circles, cubes, blobs, worms, or clustered particle bodies.

### Spells

Spells should create physical events in the simulation. Examples include pouring water, igniting a region, dropping sand, spawning roots, freezing particles, launching a projectile, carving terrain, raising a wall, creating a shield field, or destabilizing part of a structure.

Spells may have card text and targeting rules, but their gameplay effect should resolve through the battlefield simulation whenever possible.

### Structures and defenses

Cards may create walls, turrets, shields, bridges, channels, lenses, pipes, pressure chambers, or other structures. These should exist physically in the simulation and be vulnerable to appropriate physical interactions.

## Game state architecture

The project should move toward a separation between:

- Serializable deterministic gameplay state.
- Deterministic simulation update systems.
- Player command input.
- Rendering and animation.
- UI state.
- Network transport.

Rendering must observe gameplay state, not control it.

The DOM/UI layer should not be the authority for game state. Canvas rendering should not hide important gameplay state that the deterministic model does not know about.

## Multiplayer architecture target

The preferred long-term multiplayer model is deterministic lockstep.

In lockstep, each client:

1. Starts from the same seed and initial game state.
2. Receives the same ordered player commands for each tick.
3. Advances the same deterministic simulation locally.
4. Periodically compares checksums or hashes of authoritative game state.

This makes online PvP more feasible without constantly syncing the entire battlefield. It also makes replays, rollback debugging, desync detection, and deterministic testing more natural.

The architecture should not assume that the server is simulating every particle unless later design requires that. A server-authoritative model may still be used for matchmaking, validation, command relay, anti-cheat, and dispute resolution.

## Implementation priorities

Near-term work should prioritize architecture that protects the long-term vision:

1. Replace nondeterministic gameplay randomness with a seeded PRNG.
2. Introduce a fixed-tick deterministic game loop.
3. Define serializable gameplay state and command objects.
4. Make card plays issue deterministic commands with tick numbers, card ids, player ids, and placement/target coordinates.
5. Make generators, creatures, spells, bases, and cores real battlefield entities.
6. Move damage resolution toward physical simulation results instead of immediate direct HP subtraction.
7. Add deterministic state hashing for testing and future multiplayer desync detection.
8. Keep visual-only effects separate from authoritative gameplay state.

## Current prototype warning

The current prototype may still contain direct HP damage, immediate attack resolution, visual-only particles, frame-based timing, and `Math.random()`. These are acceptable only as temporary prototype scaffolding.

Before expanding card content heavily, the project should be redirected toward deterministic simulation-first architecture. Otherwise, future LAN, hotseat, and online PvP support will become much harder to add cleanly.

## Design rule of thumb

When adding a new feature, ask:

- Is this deterministic?
- Can this be represented in serializable gameplay state?
- Does this work in hotseat, LAN, and online PvP?
- Does the card physically affect the battlefield?
- Could two clients replay the same commands and reach the same result?
- Is rendering separate from gameplay authority?

If the answer is no, treat the feature as visual-only or redesign it before making it central to gameplay.
