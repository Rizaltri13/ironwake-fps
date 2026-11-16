// The look plan, in one place. A dark industrial base (canvas, surface, hairline),
// warm paper ink, and two team hues: amber for the Strikers, steel blue for the
// Sentinels. The lighting makes every shade the game needs, so no other colour
// appears in the code. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  ward: '#5b8dd9',
};

export function teamColor(team) {
  return team === 'strike' ? PALETTE.accent : PALETTE.ward;
}

export function shade(name) {
  return PALETTE[name];
}
