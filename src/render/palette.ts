/**
 * The miniature palette. Colours are chosen to sit together on a parchment page: warm
 * earths, Seljuk turquoise and cobalt, and a brown-black ink for every outline.
 */
export const PAL = {
  paper: '#efe2c2',
  ink: '#4a2c18',

  plain: '#dcd49c',
  plainAlt: '#d3d193',
  lush: '#b3cc80',
  urban: '#f0e3c2',
  hill: '#e5bfa2',
  hillRock: '#d6a791',
  tepe: '#ecd5a9',
  bank: '#c9b98a',

  road: '#f2dfb2',
  water: '#5f97c6',

  wall: '#ead6ab',
  houses: ['#f5ead4', '#f0cbb0', '#eec287', '#f7dfb8', '#e5ab8c', '#fbf7ec'],
  roofs: ['#d58a4e', '#c97b4c', '#e0a15f', '#bf6e4a', '#e8c089'],
  door: '#6b2f1c',

  stone: '#eedcb4',
  stoneDark: '#cfae80',
  stoneLight: '#f8ecd0',
  brick: '#cc644a',
  turquoise: '#2db6b1',
  lead: '#7fa5ca',
  plaster: '#fbf4e6',

  trunk: '#7a4a2a',
  kavak: '#86ad3f',
  servi: '#2c5c36',
  fruit: '#5f9a3a',
} as const;

/** Fertility overlay ramp, poor to rich, in the same miniature inks. */
export const FERTILITY_RAMP = ['#c9826a', '#e6b872', '#e9d98a', '#a9c76a', '#5f9a3a'] as const;

/**
 * Surface classes for the ink pass. Where two classes meet on screen the compositor draws
 * a line, which is how flat things (a road on the ground, water in its bed) get outlines
 * that depth and normals alone would never find.
 */
export const INK_CLASS = {
  ground: 0.1,
  road: 0.3,
  water: 0.5,
  building: 0.9,
  tree: 0.7,
} as const;
