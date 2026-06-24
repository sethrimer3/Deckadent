/** Rendering-only dark fantasy palette. Keep simulation and game rules color-free. */
export const PALETTE = {
  inkBlack: '#070604', voidBlack: '#0b0907', charcoal: '#151311', panelDark: '#1d1711',
  leather: '#2b1d12', leatherLight: '#3a2818', oldParchment: '#d7bd82', parchmentDim: '#a88d58',
  bronze: '#8f642b', mutedGold: '#c99a3a', brightGold: '#f1c85a', ember: '#d65a1f',
  emberBright: '#f08a2f', bloodRed: '#8e2418', ashGray: '#6e6a62', stone: '#62584c',
  stoneDark: '#38332d', earth: '#8a5a32', clay: '#a36b3a', waterSlate: '#58717b', ice: '#a8b8bd', moss: '#596343',
} as const;

export function coordShade(x: number, y: number): number { return ((x * 17 + y * 31) & 7) - 3; }
