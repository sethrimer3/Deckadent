/** Shared dark-fantasy palette. Rendering-only; gameplay never depends on these values. */
export const PIXEL_THEME = {
  background: '#100c09', panel: '#241a13', panelDark: '#17100c', border: '#5f4630',
  borderHighlight: '#c49a4a', textPrimary: '#f2dfb4', textMuted: '#aa9374',
  gold: '#d7a84a', ember: '#e46f26', damageRed: '#b53c27', shadow: '#090605',
  sand: '#b18b52', stone: '#68594a', wood: '#70452b', metal: '#80705b',
  ash: '#4b433b', water: '#4a91a0', core: '#c27030', parchment: '#d8bd82',
} as const;

export const PARTICLE_COLORS = {
  EMPTY: PIXEL_THEME.background, WATER: PIXEL_THEME.water, FIRE: PIXEL_THEME.ember,
  SAND: PIXEL_THEME.sand, SMOKE: PIXEL_THEME.ash, SPARK: '#f0bd4f',
  CORE: PIXEL_THEME.core, WALL: PIXEL_THEME.stone, ICE: '#9fc0bd', VINE: '#53683b',
} as const;
