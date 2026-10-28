// Copied unchanged from Ianua (~/videos/ianua/src/render/palette.js, MIT, @anxchywl)
// for tests/oracle.html because python3 -m http.server 5180 blocks imports outside ~/limen.
// Colours of the paper and ink look, shared with the video series (portals/build/src/theme.ts).

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const PAPER = {
  background: '#F7F1E9',
  wall: '#F7F1E9',
  floor: '#ECE5DC',
  ink: '#241D18',
  deep: '#E2DCD5',
  back: '#DCD5CD',
  body: '#4A413B',
  static: '#E2DCD5',
  grid: '#C9C1B7',
  mark: '#C4BCB4',
  trail: '#4A413B',
  field: '#69615C',
  heatWeak: '#4F8A9C',
  heatStrong: '#A5544A',
  heatMax: '#241D18',
  // coloured rooms: one muted colour per face, so every wall is known at a glance, also through a portal
  walls: {
    colour: {'-x': '#A8C3CB', '+x': '#E3B8A6', '-z': '#EADDB4', '+z': '#B8CDB2', '-y': '#B9B1A8', '+y': '#DCD5CD'},
  },
};

export const INK = {
  background: '#130B07',
  wall: '#1E1612',
  floor: '#241B16',
  ink: '#817C7A',
  deep: '#2A221D',
  back: '#4A413B',
  body: '#69615C',
  static: '#2A221D',
  grid: '#2E2520',
  mark: '#3A302A',
  trail: '#B5ADA6',
  field: '#817C7A',
  heatWeak: '#2F5F6D',
  heatStrong: '#9A4C43',
  heatMax: '#F7F1E9',
  walls: {
    colour: {'-x': '#21363D', '+x': '#3F2620', '-z': '#3A321E', '+z': '#25351F', '-y': '#1B1410', '+y': '#2A221D'},
  },
};

export const PORTAL = {blue: '#3E7C8F', orange: '#C27A40'};
