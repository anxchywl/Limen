// Ported from Ianua (~/videos/ianua/src/render/palette.js, MIT, @anxchywl): PAPER, INK, PORTAL and hex are
// unchanged. Limen adds ROOM (saturated wall colours by face normal), BODY and the four portal colours.


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

// Limen: four portal colours. Blue and orange from the film, then two picked to sit beside them.
PORTAL.violet = '#7E5BA6';
PORTAL.green = '#5E9A4E';
export const PORTAL_COLOURS = [PORTAL.blue, PORTAL.orange, PORTAL.violet, PORTAL.green];

// Limen: saturated colours per face normal, so every face is known at a glance, also through a portal.
// A face takes the colour of the axis its normal points along; up-facing faces are warm paper.
export const ROOM = {
  '+x': '#E2603C', // vermilion
  '-x': '#2C8DB5', // cerulean
  '+z': '#F0B32E', // saffron
  '-z': '#3E9F62', // green
  '+y': '#F2E2C4', // paper floor and tops
  '-y': '#8A73C4', // violet undersides
};

// Limen: body colours, deep enough to stand off both the walls and the paper floor
export const BODY = ['#F7F1E9', '#D2432A', '#1F78A8', '#F2A516', '#2E8B57', '#6E4FB3', '#E8679A', '#14A3A0'];
