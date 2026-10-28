// Copied unchanged from Ianua (~/videos/ianua/src/render/renderer.js, MIT, @anxchywl)
// for tests/oracle.html because python3 -m http.server 5180 blocks imports outside ~/limen.
// WebGL2 ray tracer for portal worlds. Every pixel sends a ray; when the ray meets the front of a portal
// it is carried to the partner portal and keeps going, so views through portals are exact at any depth.
// The look: matte paper surfaces, thin ink edges of constant pixel width, soft daylight, coloured rims.
//
// Aids that keep teleportation readable:
// - each pass through a portal tints what is seen in that portal's colour, so depth shows as colour
// - a portal's "open" value fades its opening from see-through (1) to a flat tinted surface (0),
//   which shows exactly where the teleporting surface is, like turning light teleportation off
// - a faint grid on every face and a large outline mark on each wall, so a view through a portal
//   always says which wall you are looking at and which way is up
// - cards: flat cut-out images (the mascot, signs) that live in the world, cast shadows and pass through portals
// - the gravity field drawn on the back wall: contour lines of the potential or of field strength, and arrows,
//   in one stone tone, from the side-view solve in core/field.js; optionally a banded strength map (1 g is the bare
//   wall, weaker tints to blue, stronger to red and then ink) and arrows that drift along the field
// - bodies are boxes, or balls (mark "ball") with two ink rings so rolling shows
// - capsules: rounded tubes with an ink silhouette (the mascot's body in 3D), each with an optional clip plane so a
//   figure partly through a portal shows on both sides

import {PAPER, INK, PORTAL, hex} from './palette.js';

const MAXB = 64;
const MAXP = 8;
const MAXC = 12;
const MAXR = 4;
const MAXF = 2;
const LINE_W = 1024;
// card images are stored square; a card's own width and height in metres set its shape
export const CARD_W = 1024;
export const CARD_H = 1024;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2D;
#define MAXB ${MAXB}
#define MAXP ${MAXP}
#define MAXC ${MAXC}
#define MAXR ${MAXR}
#define MAXF ${MAXF}
#define LINE_W ${LINE_W}
uniform vec2 uRes;
uniform vec3 uCam, uRight, uUp, uBack;
uniform float uFocal, uOrtho, uOrthoH, uFlat;
uniform int uSS;
uniform int uNR;
uniform vec3 uRMin[MAXR], uRMax[MAXR], uRSun[MAXR], uRFloor[MAXR], uRWall[MAXR];
// per-face colours (look.walls), and how much of them shows (look.wallsShown)
uniform vec3 uRFace[MAXR * 6];
uniform float uRTint[MAXR];
// a room seen only from inside it (a closed pocket): rays that start outside pass through it
uniform int uRIn[MAXR];
uniform int uRSpace[MAXR];
uniform int uRSky[MAXR];
uniform int uRFaces[MAXR];
uniform int uMarks[MAXR * 6];
uniform float uRGrid[MAXR], uRDisc[MAXR];
// a room lit only through a portal (room.sunVia): -1 its own sun, -2 no sun (the portal is closed), k >= 0 the sun
// reaches it only through portal k, and uRSun holds that sun's direction carried back through the pair
uniform int uRSunVia[MAXR];
uniform int uNB;
uniform vec3 uBC[MAXB], uBH[MAXB], uBX[MAXB], uBY[MAXB], uBZ[MAXB], uBCol[MAXB];
uniform vec4 uBClip[MAXB], uBClipSphere[MAXB];
uniform int uBMark[MAXB];
uniform int uBSpace[MAXB];
uniform int uNP;
uniform vec3 uPC[MAXP], uPU[MAXP], uPV[MAXP], uPN[MAXP], uPCol[MAXP];
uniform vec2 uPAB[MAXP];
uniform float uPDome[MAXP];
uniform int uPTwoSided[MAXP];
uniform int uPSpace[MAXP], uPTargetSpace[MAXP];
uniform int uCamSpace;
uniform int uPL[MAXP];
uniform float uPOpen[MAXP];
uniform int uNC;
uniform vec3 uCC[MAXC], uCR[MAXC], uCU[MAXC];
uniform vec4 uCClip[MAXC];
uniform int uCL[MAXC];
uniform sampler2DArray uCards;
// capsules, four texels each: end a and radius, end b, colour, clip plane
uniform highp sampler2D uCaps;
uniform int uNK;
uniform int uCapsCommon, uCapsStart[4], uCapsEnd[4];
uniform highp sampler2D uTriangles;
uniform int uNT;
uniform int uNL;
uniform highp sampler2D uLines;
uniform vec3 uLineCol[8];
uniform int uNF;
uniform vec3 uFC[MAXF];
uniform float uFB[MAXF], uFMix[MAXF], uFR[MAXF], uFY[MAXF], uFRings[MAXF], uFSpokes[MAXF];
uniform vec3 uSurfCol, uSurfLine;
uniform vec3 uBg, uWall, uFloor, uInk, uDeep, uBack2, uGridCol, uMarkCol, uSurface;
uniform int uDepth;
uniform float uLine, uTint, uThick, uPassFade, uSurfaceAlpha, uRimBand;
uniform int uPreciseRims;
uniform vec3 uLight;
uniform float uDetail;
uniform sampler2D uField;
uniform int uFMode;
uniform vec2 uFOrigin;
uniform float uFCell, uFG, uFStep, uFArrow, uFArrowG, uFHeat, uFFlow, uFBands;
// uFRamp 1: the bold map (deep blue at 0 g, teal, sand at 1 g, orange, crimson, paper above 10 g); uFRoom: the room whose
// back face carries the field (a backdrop larger than the lab room)
uniform int uFRamp, uFRoom;
uniform vec3 uHeatWeak, uHeatStrong, uHeatMax;
uniform ivec2 uFSize;
uniform float uFLevels[8];
uniform int uFNL;
uniform vec3 uFieldCol;
out vec4 outColor;

struct Hit { float t; vec3 n; vec3 col; float edge; int portal; bool front; float rim; float ao; float lit; int room; };

Hit noHit() { Hit h; h.t = 1e9; h.n = vec3(0.0); h.col = uBg; h.edge = 1e3; h.portal = -1; h.front = false; h.rim = 1e3; h.ao = 1e3; h.lit = 1.0; h.room = -1; return h; }

// the room a point is in, for its sun; the first room if none
int roomOf(vec3 p) {
  for (int r = 0; r < MAXR; r++) {
    if (r >= uNR) break;
    if (all(greaterThanEqual(p, uRMin[r] - 1e-3)) && all(lessThanEqual(p, uRMax[r] + 1e-3))) return r;
  }
  return 0;
}

// distance from a point on a face to the outline of that face's mark
float markDist(int kind, vec2 q, float r) {
  if (kind == 1) return abs(length(q) - r);
  if (kind == 2) {
    // equilateral triangle, point up
    vec2 p = q / r;
    const float k = 1.7320508;
    p.x = abs(p.x) - 1.0;
    p.y = p.y + 1.0 / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0, 0.0);
    return abs(-length(p) * sign(p.y)) * r;
  }
  if (kind == 3) return abs(max(abs(q.x), abs(q.y)) - r * 0.85);
  if (kind == 4) { vec2 a = abs(q); return abs(max(min(a.x, a.y) - r * 0.22, max(a.x, a.y) - r)); }
  return 1e3;
}

// the field texture holds per cell: potential, gravity x and y in g, strength in g; read between cell centres
vec4 fieldAt(vec2 p) {
  vec2 s = (p - uFOrigin) / uFCell - 0.5;
  ivec2 i = ivec2(floor(s));
  vec2 f = s - vec2(i);
  ivec2 hi = uFSize - 1;
  vec4 a = texelFetch(uField, clamp(i, ivec2(0), hi), 0);
  vec4 b = texelFetch(uField, clamp(i + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(uField, clamp(i + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(uField, clamp(i + ivec2(1, 1), ivec2(0), hi), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ba = b - a;
  float u = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(p - a - ba * u);
}

// distance from p to the nearest field line or arrow, in world units
float fieldInk(vec2 p, float lw) {
  float dist = 1e3;
  vec4 F = fieldAt(p);
  if ((uFMode & 1) != 0 && F.w > 1e-3) {
    float v = F.x / uFStep;
    dist = min(dist, abs(v - round(v)) * uFStep / (F.w * uFG));
  }
  if ((uFMode & 4) != 0) {
    float e = uFCell * 0.5;
    vec2 gs = vec2(fieldAt(p + vec2(e, 0.0)).w - fieldAt(p - vec2(e, 0.0)).w, fieldAt(p + vec2(0.0, e)).w - fieldAt(p - vec2(0.0, e)).w) / (2.0 * e);
    float gl = max(length(gs), 1e-4);
    for (int k = 0; k < 8; k++) {
      if (k >= uFNL) break;
      dist = min(dist, abs(F.w - uFLevels[k]) / gl);
    }
  }
  if ((uFMode & 2) != 0) {
    vec2 c0 = floor(p / uFArrow);
    for (int j = 0; j < 9; j++) {
      if (uFFlow == 0.0 && j > 0) break;
      vec2 cell = c0 + (uFFlow == 0.0 ? vec2(0.0) : vec2(float(j % 3) - 1.0, float(j / 3) - 1.0));
      vec2 c = (cell + 0.5) * uFArrow;
      vec2 g = fieldAt(c).yz;
      float m = length(g);
      if (m <= 0.02) continue;
      vec2 dir = g / m;
      float L = uFArrow * 0.4 * min(m / uFArrowG, 2.0);
      if (uFFlow != 0.0) {
        // each arrow drifts one cell along the field and starts again, shrinking in and out at the ends, every
        // other column half a step behind; the phase does not depend on the field, so a changing field does not make
        // the arrows jump
        float ph = fract(uFFlow + 0.5 * mod(cell.x, 2.0));
        c += dir * (ph - 0.5) * uFArrow;
        L *= smoothstep(0.0, 0.2, ph) * smoothstep(1.0, 0.8, ph);
        if (L < uFArrow * 0.16) continue;
      }
      vec2 tip = c + dir * L * 0.5;
      vec2 n = vec2(-dir.y, dir.x);
      float head = min(uFArrow * 0.14, L * 0.6);
      dist = min(dist, segDist(p, c - dir * L * 0.5, tip));
      dist = min(dist, segDist(p, tip, tip - dir * head + n * head * 0.6));
      dist = min(dist, segDist(p, tip, tip - dir * head - n * head * 0.6));
    }
  }
  return dist;
}

// banded strength colour: 1 g is the bare wall, weaker tints to blue, stronger to red and past 3 g to ink
vec3 boldCol(float s) {
  // bands of 0.1 g up to 2 g, then twelve to each factor of ten
  float q = s < 2.0 ? floor(s * uFBands + 0.5) / uFBands : pow(10.0, floor(log(s) / log(10.0) * 12.0 + 0.5) / 12.0);
  vec3 c0 = vec3(0.122, 0.227, 0.373), c1 = vec3(0.243, 0.486, 0.561), c2 = vec3(0.914, 0.769, 0.416);
  vec3 c3 = vec3(0.851, 0.510, 0.169), c4 = vec3(0.698, 0.227, 0.298), c5 = vec3(0.969, 0.945, 0.914);
  if (q < 0.5) return mix(c0, c1, q / 0.5);
  if (q < 1.0) return mix(c1, c2, (q - 0.5) / 0.5);
  if (q < 2.0) return mix(c2, c3, q - 1.0);
  if (q < 4.0) return mix(c3, c4, (q - 2.0) / 2.0);
  return mix(c4, c5, clamp(log(q / 4.0) / log(2.5), 0.0, 1.0));
}

vec3 heatCol(float s, vec3 wall) {
  if (uFRamp == 1) return boldCol(s);
  float q = floor(s * uFBands + 0.5) / uFBands;
  if (q < 1.0) return mix(uHeatWeak, wall, q * q);
  if (q < 2.0) return mix(wall, uHeatStrong, q - 1.0);
  return mix(uHeatStrong, uHeatMax, clamp((q - 2.0) / 2.0, 0.0, 1.0));
}

void roomHit(vec3 o, vec3 d, float pxBase, float pxGrow, int space, inout Hit h) {
  for (int r = 0; r < MAXR; r++) {
  if (r >= uNR) break;
    if (uRSpace[r] >= 0 && uRSpace[r] != space) continue;
  vec3 uRoomMin = uRMin[r];
  vec3 uRoomMax = uRMax[r];
  if (uRIn[r] == 1 && (any(lessThan(o, uRoomMin - 1e-3)) || any(greaterThan(o, uRoomMax + 1e-3)))) continue;
  float uGrid = uRGrid[r];
  for (int f = 0; f < 6; f++) {
    if ((uRFaces[r] & (1 << f)) == 0) continue;
    int ax = f / 2;
    bool hi = (f % 2) == 1;
    float plane = hi ? uRoomMax[ax] : uRoomMin[ax];
    vec3 inward = vec3(0.0);
    inward[ax] = hi ? -1.0 : 1.0;
    if (dot(d, inward) >= 0.0) continue;
    float t = (plane - o[ax]) / d[ax];
    if (t <= 1e-4 || t >= h.t) continue;
    vec3 p = o + d * t;
    int a1 = (ax + 1) % 3;
    int a2 = (ax + 2) % 3;
    if (p[a1] < uRoomMin[a1] || p[a1] > uRoomMax[a1] || p[a2] < uRoomMin[a2] || p[a2] > uRoomMax[a2]) continue;
    float e = min(min(p[a1] - uRoomMin[a1], uRoomMax[a1] - p[a1]), min(p[a2] - uRoomMin[a2], uRoomMax[a2] - p[a2]));
    vec3 col = (ax == 1 && !hi) ? uRFloor[r] : uRWall[r];
    float tinted = uRTint[r];
    col = mix(col, uRFace[r * 6 + f], tinted);
    // on a coloured face the grid and the marks are a deeper shade of the face itself
    vec3 gridCol = mix(uGridCol, mix(col, uInk, 0.2), tinted);
    vec3 markCol = mix(uMarkCol, mix(col, uInk, 0.32), tinted);
    float tp = pxBase + pxGrow * t;
    float lw = tp * uLine;
    if (uGrid > 0.0) {
      vec2 g = vec2(p[a1], p[a2]) / uGrid;
      vec2 gd = abs(g - round(g)) * uGrid;
      float gl = min(gd.x, gd.y);
      col = mix(col, gridCol, (1.0 - smoothstep(0.6 * lw, 0.6 * lw + tp, gl)) * mix(0.4, 0.7, tinted));
    }
    int mark = uMarks[r * 6 + f];
    if (mark > 0) {
      vec2 c = vec2(uRoomMin[a1] + uRoomMax[a1], uRoomMin[a2] + uRoomMax[a2]) * 0.5;
      vec2 q = vec2(p[a1], p[a2]) - c;
      if (ax == 0) q = q.yx;
      float rr = 0.2 * min(uRoomMax[a1] - uRoomMin[a1], uRoomMax[a2] - uRoomMin[a2]);
      float md = markDist(mark, q, rr);
      col = mix(col, markCol, 1.0 - smoothstep(2.2 * lw, 2.2 * lw + tp, md));
    }
    if (uFHeat > 0.0 && ax == 2 && !hi && r == uFRoom) {
      // the bands, with a thin line where one band meets the next
      vec4 F0 = fieldAt(p.xy);
      col = mix(col, heatCol(F0.w, col), uFHeat);
      float e = uFCell * 0.5;
      float gs = length(vec2(fieldAt(p.xy + vec2(e, 0.0)).w - fieldAt(p.xy - vec2(e, 0.0)).w, fieldAt(p.xy + vec2(0.0, e)).w - fieldAt(p.xy - vec2(0.0, e)).w)) / (2.0 * e);
      float v = F0.w * uFBands - 0.5;
      float bd = abs(v - round(v)) / (uFBands * max(gs, 1e-4));
      col = mix(col, uFieldCol, (1.0 - smoothstep(0.5 * lw, 0.5 * lw + tp, bd)) * 0.35 * uFHeat);
    }
    if (uFMode > 0 && ax == 2 && !hi && r == uFRoom) {
      float fd = fieldInk(p.xy, lw);
      col = mix(col, uFieldCol, 1.0 - smoothstep(0.9 * lw, 0.9 * lw + tp, fd));
    }
    bool sky = uRSky[r] == 1 && (ax != 1 || hi);
    h.t = t; h.n = inward; h.col = col; h.edge = sky ? 1e3 : e; h.ao = sky ? 1e3 : e; h.portal = -1; h.rim = 1e3; h.lit = sky ? 0.0 : 1.0; h.room = r;
  }
  }
}

bool boxT(vec3 o, vec3 d, int i, out float tn, out vec3 nl, out bool cut, out vec3 lp) {
  mat3 R = mat3(uBX[i], uBY[i], uBZ[i]);
  vec3 ro = transpose(R) * (o - uBC[i]);
  vec3 rd = transpose(R) * d;
  vec3 hs = uBH[i];
  float tf;
  if (uBMark[i] == 2) {
    // a ball of radius h.x
    float b = dot(ro, rd);
    float disc = b * b - dot(ro, ro) + hs.x * hs.x;
    if (disc < 0.0) return false;
    tn = -b - sqrt(disc);
    tf = -b + sqrt(disc);
    nl = normalize(ro + rd * tn);
  } else {
    vec3 inv = 1.0 / rd;
    vec3 t1 = (-hs - ro) * inv;
    vec3 t2 = (hs - ro) * inv;
    vec3 mn = min(t1, t2);
    vec3 mx = max(t1, t2);
    tn = max(max(mn.x, mn.y), mn.z);
    tf = min(min(mx.x, mx.y), mx.z);
    nl = tn == mn.x ? vec3(-sign(rd.x), 0.0, 0.0) : (tn == mn.y ? vec3(0.0, -sign(rd.y), 0.0) : vec3(0.0, 0.0, -sign(rd.z)));
  }
  cut = false;
  vec4 cp = uBClip[i];
  if (dot(cp.xyz, cp.xyz) > 0.5) {
    float dn = dot(cp.xyz, d);
    float s = dot(cp.xyz, o) - cp.w;
    if (abs(dn) < 1e-9) { if (s < 0.0) return false; }
    else {
      float tp = -s / dn;
      if (dn > 0.0) { if (tp > tn) { tn = tp; cut = true; } }
      else tf = min(tf, tp);
    }
  }
  vec4 sphere = uBClipSphere[i];
  if (abs(sphere.w) > 0.0) {
    vec3 q = o - sphere.xyz;
    float b = dot(q, d);
    float disc = b * b - dot(q, q) + sphere.w * sphere.w;
    if (disc < 0.0) { if (sphere.w > 0.0) return false; }
    else {
      float enter = -b - sqrt(disc);
      float leave = -b + sqrt(disc);
      float before = tn;
      if (sphere.w > 0.0) { tn = max(tn, enter); tf = min(tf, leave); }
      else if (tn < enter) tf = min(tf, enter);
      else tn = max(tn, leave);
      if (tn > before) { cut = true; tn += 1e-5; }
    }
  }
  lp = ro + rd * tn;
  return tn <= tf && tn > 1e-4;
}

void boxHit(vec3 o, vec3 d, int i, float pxBase, float pxGrow, inout Hit h) {
  float tn; vec3 nl; bool cut; vec3 lp;
  if (!boxT(o, d, i, tn, nl, cut, lp) || tn >= h.t) return;
  h.t = tn; h.col = uBCol[i]; h.portal = -1; h.rim = 1e3; h.ao = 1e3; h.lit = 1.0;
  if (cut) { h.n = abs(uBClipSphere[i].w) > 0.0 ? normalize(o + d * tn - uBClipSphere[i].xyz) * sign(uBClipSphere[i].w) : uBClip[i].xyz; h.edge = 1e3; h.col = mix(uBCol[i], uWall, 0.35); return; }
  h.n = mat3(uBX[i], uBY[i], uBZ[i]) * nl;
  if (uBMark[i] == 2) {
    // outline where the ball turns away from the ray, and two rings fixed in the ball
    float c = abs(dot(h.n, d));
    h.edge = uBH[i].x * (1.0 - sqrt(max(0.0, 1.0 - c * c)));
    float tp = pxBase + pxGrow * tn;
    float lw = tp * uLine;
    float md = min(abs(lp.z), abs(lp.x));
    h.col = mix(h.col, uWall, (1.0 - smoothstep(0.9 * lw, 0.9 * lw + tp, md)) * 0.8);
    return;
  }
  vec3 q = uBH[i] - abs(lp);
  vec2 f = abs(nl.x) > 0.5 ? q.yz : (abs(nl.y) > 0.5 ? q.xz : q.xy);
  h.edge = min(f.x, f.y);
  if (uBMark[i] == 1) {
    // the cube's thin inner square, the same mark it has in the flat diagrams
    float inset = 0.2 * min(min(uBH[i].x, uBH[i].y), uBH[i].z);
    float tp = pxBase + pxGrow * tn;
    float lw = tp * uLine;
    float md = abs(min(f.x, f.y) - inset);
    h.col = mix(h.col, uWall, (1.0 - smoothstep(0.9 * lw, 0.9 * lw + tp, md)) * 0.85);
  }
}

void portalHit(vec3 o, vec3 d, int i, inout Hit h) {
  // a closed portal (shrunk to a point) is not there
  if (min(uPAB[i].x, uPAB[i].y) < 1e-4) return;
  if (abs(uPDome[i]) > 0.0) {
    vec3 q = o - uPC[i];
    vec3 lo = vec3(dot(q, uPU[i]), dot(q, uPV[i]), dot(q, uPN[i]));
    vec3 ld = vec3(dot(d, uPU[i]), dot(d, uPV[i]), dot(d, uPN[i]));
    vec3 ab = vec3(uPAB[i], abs(uPDome[i]));
    vec3 p = lo / ab;
    vec3 v = ld / ab;
    float A = dot(v, v);
    float B = 2.0 * dot(p, v);
    float C = dot(p, p) - 1.0;
    float disc = B * B - 4.0 * A * C;
    if (disc < 0.0) return;
    float s = sqrt(disc);
    for (int root = 0; root < 2; root++) {
      float t = (-B + (root == 0 ? -s : s)) / (2.0 * A);
      if (t <= 1e-4 || t >= h.t) continue;
      vec3 hit = lo + ld * t;
      if (hit.z * sign(uPDome[i]) < 0.0) continue;
      float r = length(hit.xy / uPAB[i]);
      h.t = t; h.portal = i; h.front = true; h.n = normalize(uPU[i] * hit.x / (ab.x * ab.x) + uPV[i] * hit.y / (ab.y * ab.y) + uPN[i] * hit.z / (ab.z * ab.z));
      h.rim = uPreciseRims == 1 ? 1e3 : (1.0 - r) * min(uPAB[i].x, uPAB[i].y); h.edge = 1e3; h.ao = 1e3;
      return;
    }
    return;
  }
  float dn = dot(d, uPN[i]);
  if (abs(dn) < 1e-9) return;
  float t = dot(uPC[i] - o, uPN[i]) / dn;
  if (t <= 1e-4 || t >= h.t) return;
  vec3 q = o + d * t - uPC[i];
  vec2 l = vec2(dot(q, uPU[i]), dot(q, uPV[i])) / uPAB[i];
  float r = length(l);
  if (r > 1.0) return;
  h.t = t; h.portal = i; h.front = dn < 0.0 || uPTwoSided[i] == 1; h.n = dn < 0.0 ? uPN[i] : -uPN[i];
  h.rim = (1.0 - r) * min(uPAB[i].x, uPAB[i].y); h.edge = 1e3; h.ao = 1e3;
}

// the portal's rim as a thin elliptic band around the opening, so a portal seen edge-on is still a coloured bar
void rimHit(vec3 o, vec3 d, int i, inout Hit h) {
  if (min(uPAB[i].x, uPAB[i].y) < 1e-4) return;
  vec3 q = o - uPC[i];
  vec3 lo = vec3(dot(q, uPU[i]), dot(q, uPV[i]), dot(q, uPN[i]));
  vec3 ld = vec3(dot(d, uPU[i]), dot(d, uPV[i]), dot(d, uPN[i]));
  if (uPreciseRims == 1 && abs(ld.z) > 1e-8) {
    float t = -lo.z / ld.z;
    float radius = length((lo.xy + ld.xy * t) / uPAB[i]);
    if (t > 1e-4 && t < h.t && abs(radius - 1.0) * min(uPAB[i].x, uPAB[i].y) < uThick) {
      h.t = t; h.portal = i; h.rim = 0.0; h.front = false; h.edge = 1e3; h.ao = 1e3;
    }
  }
  vec2 ab2 = uPAB[i] * uPAB[i];
  float A = ld.x * ld.x / ab2.x + ld.y * ld.y / ab2.y;
  float B = 2.0 * (lo.x * ld.x / ab2.x + lo.y * ld.y / ab2.y);
  float C = lo.x * lo.x / ab2.x + lo.y * lo.y / ab2.y - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (A < 1e-12 || disc < 0.0) return;
  float s = sqrt(disc);
  for (int k = 0; k < 2; k++) {
    float t = (-B + (k == 0 ? -s : s)) / (2.0 * A);
    if (t <= 1e-4 || t >= h.t) continue;
    if (abs(lo.z + ld.z * t) > uThick) continue;
    h.t = t; h.portal = i; h.rim = 0.0; h.front = false; h.edge = 1e3; h.ao = 1e3;
    return;
  }
}

// lines: polylines with a colour and a width in pixels (motion trails, streamers, rings, cuts). They are part of
// the world, so they show through portals. Stored in a float texture: two texels per line (bounding sphere;
// first point, point count, colour, width), then one texel per point.
vec4 lineTexel(int k) { return texelFetch(uLines, ivec2(k % LINE_W, k / LINE_W), 0); }

void lineHit(vec3 o, vec3 d, float pxBase, float pxGrow, inout Hit h) {
  for (int i = 0; i < 4096; i++) {
    if (i >= uNL) break;
    vec4 S = lineTexel(2 * i);
    vec4 info = lineTexel(2 * i + 1);
    vec3 oc = S.xyz - o;
    float tc = max(dot(oc, d), 0.0);
    if (tc - S.w >= h.t) continue;
    float slack = S.w + info.w * (pxBase + pxGrow * (tc + S.w)) * uLine;
    if (dot(oc, oc) - tc * tc > slack * slack && dot(oc, oc) > slack * slack) continue;
    int first = int(info.x);
    int count = int(info.y);
    vec3 a = lineTexel(first).xyz;
    for (int k = 1; k < 4096; k++) {
      if (k >= count) break;
      vec3 b = lineTexel(first + k).xyz;
      vec3 ba = b - a;
      vec3 oa = o - a;
      float bb = dot(ba, ba);
      float bd = dot(ba, d);
      float denom = bb - bd * bd;
      if (denom > 1e-12 && bb > 1e-12) {
        float t = (bb * dot(-oa, d) + bd * dot(oa, ba)) / denom;
        float u = clamp((dot(oa, ba) + t * bd) / bb, 0.0, 1.0);
        t = max(dot(a + ba * u - o, d), 0.0);
        float r = info.w * (pxBase + pxGrow * t) * uLine;
        if (t > 1e-4 && t < h.t && length(o + d * t - (a + ba * u)) <= r) {
          h.t = t; h.col = uLineCol[int(info.z)]; h.portal = -1; h.edge = 1e3; h.ao = 1e3; h.rim = 1e3; h.lit = 0.0; h.n = -d;
        }
      }
      a = b;
    }
  }
}

// a surface of revolution about the vertical through c, joining two sheets by a throat of radius b: the
// embedding diagram of a wormhole. Its profile r(y) blends Flamm's paraboloid (Einstein and Rosen),
// r = b + y^2 / 4b, with the catenoid of the Ellis wormhole (a Morris and Thorne example), r = b cosh(y / b).
// Drawn with rings of constant r and lines of constant angle.
float profile(int i, float y) {
  float b = uFB[i];
  return mix(b + y * y / (4.0 * b), b * cosh(clamp(y / b, -20.0, 20.0)), uFMix[i]);
}
float profileD(int i, float y) {
  float b = uFB[i];
  return mix(y / (2.0 * b), sinh(clamp(y / b, -20.0, 20.0)), uFMix[i]);
}

void surfHit(vec3 o, vec3 d, float pxBase, float pxGrow, inout Hit h) {
  for (int i = 0; i < MAXF; i++) {
    if (i >= uNF) break;
    vec3 c = uFC[i];
    float R = uFR[i];
    float Y = uFY[i];
    // clip the ray to the cylinder of radius R and height 2Y around the axis
    vec2 oq = o.xz - c.xz;
    float A = dot(d.xz, d.xz);
    float B = dot(oq, d.xz);
    float C = dot(oq, oq) - R * R;
    float disc = B * B - A * C;
    if (A < 1e-12 || disc < 0.0) continue;
    float s = sqrt(disc);
    float t0 = (-B - s) / A;
    float t1 = (-B + s) / A;
    float ty0 = (c.y - Y - o.y) / d.y;
    float ty1 = (c.y + Y - o.y) / d.y;
    if (abs(d.y) > 1e-9) { t0 = max(t0, min(ty0, ty1)); t1 = min(t1, max(ty0, ty1)); }
    else if (abs(o.y - c.y) > Y) continue;
    t0 = max(t0, 1e-4);
    t1 = min(t1, h.t);
    if (t0 >= t1) continue;
    // march on f = rho - r(y), refine a sign change by bisection
    float t = t0;
    vec3 p = o + d * t;
    float f = length(p.xz - c.xz) - profile(i, p.y - c.y);
    float found = -1.0;
    for (int k = 0; k < 160; k++) {
      float dr = profileD(i, p.y - c.y);
      float slope = sqrt(1.0 + dr * dr);
      float stepT = max(abs(f) / slope * 0.8, 1e-3 * R);
      float tn = min(t + stepT, t1);
      vec3 pn = o + d * tn;
      float fn = length(pn.xz - c.xz) - profile(i, pn.y - c.y);
      if (sign(fn) != sign(f)) {
        float lo = t, hi = tn;
        for (int j = 0; j < 24; j++) {
          float m = 0.5 * (lo + hi);
          vec3 pm = o + d * m;
          float fm = length(pm.xz - c.xz) - profile(i, pm.y - c.y);
          if (sign(fm) == sign(f)) lo = m; else hi = m;
        }
        found = 0.5 * (lo + hi);
        break;
      }
      t = tn; p = pn; f = fn;
      if (t >= t1) break;
    }
    if (found < 0.0) continue;
    vec3 q = o + d * found - c;
    float rho = length(q.xz);
    vec3 n = normalize(vec3(q.x / rho, -profileD(i, q.y), q.z / rho));
    if (dot(n, d) > 0.0) n = -n;
    float tp = pxBase + pxGrow * found;
    float lw = tp * uLine;
    // grid: rings of constant rho, lines of constant angle
    float ring = R / uFRings[i];
    float rd = abs(rho - round(rho / ring) * ring);
    float ang = atan(q.z, q.x) / 6.2831853 * uFSpokes[i];
    float sd = abs(ang - round(ang)) / uFSpokes[i] * 6.2831853 * rho;
    vec3 col = mix(uSurfCol, uSurfLine, 1.0 - smoothstep(0.7 * lw, 0.7 * lw + tp, min(rd, sd)));
    h.t = found; h.n = n; h.col = col; h.portal = -1; h.rim = 1e3; h.ao = 1e3; h.lit = 1.0;
    // silhouette and outer edge in ink
    float c2 = abs(dot(n, d));
    h.edge = min(rho * c2 * 0.6, R - rho);
  }
}

bool cardT(vec3 o, vec3 d, int i, out float t, out vec4 texel) {
  vec3 n = normalize(cross(uCR[i], uCU[i]));
  float dn = dot(d, n);
  texel = vec4(0.0);
  if (abs(dn) < 1e-9) return false;
  t = dot(uCC[i] - o, n) / dn;
  if (t <= 1e-4) return false;
  vec3 p = o + d * t;
  vec4 cp = uCClip[i];
  if (dot(cp.xyz, cp.xyz) > 0.5 && dot(cp.xyz, p) < cp.w) return false;
  vec3 q = p - uCC[i];
  vec2 s = vec2(dot(q, uCR[i]) / dot(uCR[i], uCR[i]), dot(q, uCU[i]) / dot(uCU[i], uCU[i]));
  if (abs(s.x) > 1.0 || abs(s.y) > 1.0) return false;
  texel = texture(uCards, vec3(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5, float(uCL[i])));
  return texel.a > 0.5;
}

// ray against a capsule (after Inigo Quilez); a capsule with both ends together is a sphere
float capT(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float ra) {
  vec3 ba = pb - pa;
  vec3 oa = ro - pa;
  float baba = dot(ba, ba);
  if (baba < 1e-10) {
    float b = dot(oa, rd);
    float c = dot(oa, oa) - ra * ra;
    float hh = b * b - c;
    return hh > 0.0 ? -b - sqrt(hh) : -1.0;
  }
  float bard = dot(ba, rd);
  float baoa = dot(ba, oa);
  float rdoa = dot(rd, oa);
  float oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - ra * ra * baba;
  float hh = b * b - a * c;
  if (hh >= 0.0) {
    // the body of the tube; a ray along the axis (a = 0) can only meet an end
    float y = bard > 0.0 ? -1.0 : baba + 1.0;
    if (a > 1e-12) {
      float t = (-b - sqrt(hh)) / a;
      y = baoa + t * bard;
      if (y > 0.0 && y < baba) return t;
    }
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc);
    c = dot(oc, oc) - ra * ra;
    hh = b * b - c;
    if (hh > 0.0) return -b - sqrt(hh);
  }
  return -1.0;
}

bool capAt(vec3 o, vec3 d, int i, out float t, out vec3 n) {
  vec4 A = texelFetch(uCaps, ivec2(0, i), 0);
  vec4 B = texelFetch(uCaps, ivec2(1, i), 0);
  vec4 P = texelFetch(uCaps, ivec2(3, i), 0);
  t = capT(o, d, A.xyz, B.xyz, A.w);
  if (t <= 1e-4) return false;
  vec3 p = o + d * t;
  if (dot(P.xyz, P.xyz) > 0.5 && dot(P.xyz, p) < P.w) return false;
  vec3 ba = B.xyz - A.xyz;
  float k = dot(ba, ba) > 1e-10 ? clamp(dot(p - A.xyz, ba) / dot(ba, ba), 0.0, 1.0) : 0.0;
  n = (p - A.xyz - k * ba) / A.w;
  return true;
}

void capHit(vec3 o, vec3 d, int i, inout Hit h) {
  float t; vec3 n;
  if (!capAt(o, d, i, t, n) || t >= h.t) return;
  float r = texelFetch(uCaps, ivec2(0, i), 0).w;
  h.t = t; h.n = n; h.col = texelFetch(uCaps, ivec2(2, i), 0).rgb; h.portal = -1; h.rim = 1e3; h.ao = 1e3; h.lit = 1.0; h.room = -1;
  // ink where the tube turns away from the eye
  float c = abs(dot(n, d));
  h.edge = r * (1.0 - sqrt(max(0.0, 1.0 - c * c)));
}

void cardHit(vec3 o, vec3 d, int i, inout Hit h) {
  float t; vec4 texel;
  if (!cardT(o, d, i, t, texel) || t >= h.t) return;
  h.t = t; h.col = texel.rgb; h.portal = -1; h.edge = 1e3; h.ao = 1e3; h.rim = 1e3; h.lit = 0.0;
  vec3 n = normalize(cross(uCR[i], uCU[i]));
  h.n = dot(n, d) < 0.0 ? n : -n;
}

float sunShadow(vec3 p, vec3 uSun, int space) {
  for (int i = 0; i < MAXB; i++) {
    if (i >= uNB) break;
    if (uBSpace[i] >= 0 && uBSpace[i] != space) continue;
    float tn; vec3 nl; bool cut; vec3 lp;
    if (boxT(p, uSun, i, tn, nl, cut, lp)) return 0.0;
  }
  for (int i = 0; i < MAXC; i++) {
    if (i >= uNC) break;
    float t; vec4 texel;
    if (cardT(p, uSun, i, t, texel)) return 0.0;
  }
  for (int group = 0; group < 2; group++) {
    int from = group == 0 ? 0 : uCapsStart[min(space, 3)];
    int until = group == 0 ? uCapsCommon : uCapsEnd[min(space, 3)];
    for (int i = from; i < until; i++) {
      float t; vec3 n;
      if (capAt(p, uSun, i, t, n)) return 0.0;
    }
  }
  return 1.0;
}

// 1 if a ray from p toward the sun passes into portal k's opening from its front, 0 if a wall would stop it
float throughPortal(vec3 p, vec3 dir, int k) {
  vec3 n = uPN[k];
  float dn = dot(dir, n);
  if (dn >= 0.0 || dot(p - uPC[k], n) <= 0.0) return 0.0;
  vec3 q = p + dir * (dot(uPC[k] - p, n) / dn) - uPC[k];
  vec2 l = vec2(dot(q, uPU[k]) / uPAB[k].x, dot(q, uPV[k]) / uPAB[k].y);
  return 1.0 - smoothstep(0.97, 1.03, length(l));
}

void triangleHit(vec3 o, vec3 d, int i, int space, inout Hit h) {
  vec4 ac = texelFetch(uTriangles, ivec2(0, i), 0);
  if (ac.w >= 0.0 && int(ac.w) != space) return;
  vec3 a = ac.xyz;
  vec3 e1 = texelFetch(uTriangles, ivec2(1, i), 0).xyz - a;
  vec3 e2 = texelFetch(uTriangles, ivec2(2, i), 0).xyz - a;
  vec3 p = cross(d, e2);
  float det = dot(e1, p);
  if (abs(det) < 1e-8) return;
  vec3 v = o - a;
  float u = dot(v, p) / det;
  if (u < 0.0 || u > 1.0) return;
  vec3 q = cross(v, e1);
  float w = dot(d, q) / det;
  if (w < 0.0 || w + u > 1.0) return;
  float t = dot(e2, q) / det;
  if (t <= 1e-4 || t >= h.t) return;
  h.t = t; h.n = normalize(cross(e1, e2));
  if (dot(h.n, d) > 0.0) h.n = -h.n;
  h.col = texelFetch(uTriangles, ivec2(3, i), 0).rgb;
  h.edge = 1e3; h.ao = 1e3; h.portal = -1; h.rim = 1e3; h.lit = 1.0; h.room = -1;
}

vec3 trace(vec3 o, vec3 d, float px0, float pxGrow) {
  int space = uCamSpace;
  float travelled = 0.0;
  vec3 acc = vec3(0.0);
  vec3 through = vec3(1.0);
  for (int k = 0; k < 64; k++) {
    float pxNow = px0 + pxGrow * travelled;
    Hit h = noHit();
    roomHit(o, d, pxNow, pxGrow, space, h);
    for (int i = 0; i < MAXB; i++) { if (i >= uNB) break; if (uBSpace[i] >= 0 && uBSpace[i] != space) continue; boxHit(o, d, i, pxNow, pxGrow, h); }
    for (int i = 0; i < MAXC; i++) { if (i >= uNC) break; cardHit(o, d, i, h); }
    for (int group = 0; group < 2; group++) {
      int from = group == 0 ? 0 : uCapsStart[min(space, 3)];
      int until = group == 0 ? uCapsCommon : uCapsEnd[min(space, 3)];
      for (int i = from; i < until; i++) capHit(o, d, i, h);
    }
    for (int i = 0; i < 512; i++) { if (i >= uNT) break; triangleHit(o, d, i, space, h); }
    lineHit(o, d, pxNow, pxGrow, h);
    surfHit(o, d, pxNow, pxGrow, h);
    for (int i = 0; i < MAXP; i++) { if (i >= uNP) break; if (uPSpace[i] >= 0 && uPSpace[i] != space) continue; portalHit(o, d, i, h); rimHit(o, d, i, h); }
    if (h.t >= 1e9) {
      // a finite solar disc and glare keep the opening readable against the sky
      int r = roomOf(o);
      vec3 bg = uBg;
      if (uRDisc[r] > 0.0) {
        float ang = acos(clamp(dot(d, normalize(uRSun[r])), -1.0, 1.0));
        float soft = max(pxGrow * 1.5, 0.0005);
        float halo = exp(-pow(ang / max(uRDisc[r] * 9.0, 0.10), 2.0));
        float disc = 1.0 - smoothstep(uRDisc[r] - soft, uRDisc[r] + soft, ang);
        float innerGlow = exp(-pow(ang / max(uRDisc[r] * 2.5, 0.025), 2.0));
        // a low sun is warmer, and warms the sky along the horizon on its side
        vec3 sn = normalize(uRSun[r]);
        float low = 1.0 - smoothstep(0.02, 0.35, sn.y);
        vec2 dh = normalize(d.xz + 1e-6);
        vec2 sh = normalize(sn.xz + 1e-6);
        float side = 0.5 + 0.5 * dot(dh, sh);
        float band = exp(-pow(max(d.y, 0.0) / 0.12, 2.0)) * side * side * low;
        bg = mix(bg, vec3(0.97, 0.80, 0.62), 0.55 * band);
        bg = mix(bg, mix(vec3(0.99, 0.78, 0.52), vec3(0.98, 0.62, 0.36), low), (0.28 + 0.2 * low) * halo);
        bg = mix(bg, mix(vec3(1.0, 0.92, 0.70), vec3(1.0, 0.82, 0.55), low), 0.6 * innerGlow);
        bg = mix(bg, mix(vec3(1.0, 0.98, 0.88), vec3(1.0, 0.93, 0.74), low), disc);
      }
      return acc + through * bg;
    }
    vec3 p = o + d * h.t;
    float px = pxNow + pxGrow * h.t;
    if (h.portal >= 0) {
      int i = h.portal;
      float rimW = 3.2 * px * uLine + uRimBand;
      if (h.rim < rimW) return acc + through * uPCol[i];
      if (!h.front) return acc + through * mix(uBack2, uPCol[i], 0.12);
      // the teleporting surface itself, faded in when the portal is not fully open
      vec3 surface = mix(uSurface, uPCol[i], 0.45);
      float band = 1.0 - smoothstep(0.0, 0.12 * min(uPAB[i].x, uPAB[i].y), h.rim - rimW);
      surface = mix(surface, uPCol[i], band * 0.5);
      float open = uPOpen[i];
      if (k == 0 && uSurfaceAlpha > 0.0) {
        float facing = abs(dot(h.n, d));
        float shellShade = 0.68 + 0.32 * abs(dot(h.n, normalize(vec3(-0.4, 0.8, 0.5))));
        vec3 shell = mix(vec3(0.92), uPCol[i], 0.4) * shellShade;
        float alpha = uSurfaceAlpha * (0.65 + 0.35 * pow(1.0 - facing, 2.0));
        acc += through * shell * alpha;
        through *= 1.0 - alpha;
      }
      acc += through * (1.0 - open) * surface;
      through *= open;
      if (open <= 0.001) return acc;
      if (k >= uDepth) return acc + through * uDeep;
      // each pass tints the view in the portal's colour and dims it a little, so depth reads at a glance
      through *= mix(vec3(1.0), uPCol[i], uTint) * uPassFade;
      int j = uPL[i];
      if (uPTargetSpace[i] >= 0) space = uPTargetSpace[i];
      vec3 q = p - uPC[i];
      vec3 lq = vec3(dot(q, uPU[i]), dot(q, uPV[i]), dot(q, uPN[i]));
      vec3 ld = vec3(dot(d, uPU[i]), dot(d, uPV[i]), dot(d, uPN[i]));
      // partners of different sizes scale what passes between them (the pocket dimension shrinks you on every
      // pass); the world size of a pixel scales with it, so lines keep their width on screen
      float sc = uPAB[j].x / uPAB[i].x;
      o = uPC[j] + sc * (-lq.x * uPU[j] + lq.y * uPV[j] - lq.z * uPN[j]);
      d = -ld.x * uPU[j] + ld.y * uPV[j] - ld.z * uPN[j];
      px0 = (px0 + pxGrow * (travelled + h.t)) * sc;
      pxGrow *= sc;
      travelled = 0.0;
      o += d * 2e-4 * sc;
      continue;
    }
    int sr = h.room >= 0 ? h.room : roomOf(p);
    vec3 sun = normalize(uRSun[sr]);
    int via = uRSunVia[sr];
    float lambert = via == -2 ? 0.0 : max(dot(h.n, sun), 0.0);
    float shadow = (lambert > 0.0 && uFlat < 1.0) ? sunShadow(p + h.n * 1e-3, sun, space) : 1.0;
    // sunlight through a portal: only what the opening lets in, and none of the soft fill a sky would give
    float beam = via >= 0 ? throughPortal(p + h.n * 1e-3, sun, via) : 1.0;
    // a room lit through an opening also gets a little light bounced in from the far side
    float amb = uLight.x + (via >= 0 ? 0.12 : via == -2 ? 0.08 : 0.0);
    float light = via >= 0 ? amb + uLight.y * 1.6 * lambert * shadow * beam : amb + uLight.y * lambert * mix(0.2, 1.0, shadow);
    float ao = mix(0.93, 1.0, smoothstep(0.0, 0.7, h.ao));
    float shade = mix(light * mix(ao, ao * ao, uLight.z), 1.0, max(uFlat, 1.0 - h.lit));
    vec3 col = h.col * shade;
    float grain = sin(p.x * 3.0 + sin(p.z * 1.3)) * sin(p.y * 7.0 + p.z * 4.0);
    col *= 1.0 + uDetail * grain * 0.018;
    float lw = 1.25 * px * uLine;
    float ink = 1.0 - smoothstep(lw, lw + px, h.edge);
    return acc + through * mix(col, uInk, ink);
  }
  return acc + through * uDeep;
}

void main() {
  vec3 acc = vec3(0.0);
  float orthoPx = uOrthoH / (0.5 * uRes.y);
  for (int sx = 0; sx < 4; sx++) {
    if (sx >= uSS) break;
    for (int sy = 0; sy < 4; sy++) {
      if (sy >= uSS) break;
      vec2 jitter = (vec2(float(sx), float(sy)) + 0.5) / float(uSS);
      vec2 pix = gl_FragCoord.xy - 0.5 + jitter - 0.5 * uRes;
      vec3 dp = normalize(uRight * pix.x + uUp * pix.y - uBack * uFocal);
      vec3 oo = uCam + (uRight * pix.x + uUp * pix.y) * orthoPx;
      vec3 o = mix(uCam, oo, uOrtho);
      vec3 d = normalize(mix(dp, -uBack, uOrtho));
      // world size of one pixel: grows with distance in perspective, constant in orthographic
      acc += trace(o, d, orthoPx * uOrtho, (1.0 - uOrtho) / uFocal);
    }
  }
  outColor = vec4(acc / float(uSS * uSS), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const MARKS = {none: 0, circle: 1, triangle: 2, square: 3, cross: 4};
const FACE_BIT = {'-x': 0, '+x': 1, '-y': 2, '+y': 3, '-z': 4, '+z': 5};

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {antialias: false, preserveDrawingBuffer: true});
  if (!gl) throw new Error('WebGL2 is not available');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  const U = {};
  const u = (name) => (U[name] ??= gl.getUniformLocation(prog, name));

  // one layer per card image; images are drawn into the layer stretched to CARD_W x CARD_H
  const cardTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, cardTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, CARD_W, CARD_H, MAXC);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // the gravity field, one RGBA float texel per cell, uploaded when the scene brings a new one
  const fieldTex = gl.createTexture();
  let fieldImage = null;
  gl.bindTexture(gl.TEXTURE_2D, fieldTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));

  // capsules: one row of four texels each
  const capTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, capTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(16));

  const triangleTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, triangleTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(16));

  // lines: bounding spheres, then points, in one float texture LINE_W texels wide
  const lineTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lineTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  function setCardImage(layer, source) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, cardTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, CARD_W, CARD_H, 1, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function render(scene, cam, opts = {}) {
    const w = canvas.width;
    const h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, cardTex);
    gl.uniform1i(u('uCards'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.uniform1i(u('uField'), 1);
    const F = scene.field;
    if (F && F !== fieldImage) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, F.w, F.h, 0, gl.RGBA, gl.FLOAT, F.data);
      fieldImage = F;
    }

    const look = scene.look;
    const pal = look.ground === 'ink' ? INK : PAPER;
    gl.uniform2f(u('uRes'), w, h);
    gl.uniform3fv(u('uCam'), cam.pos);
    gl.uniform1i(u('uCamSpace'), cam.space ?? 0);
    gl.uniform3fv(u('uRight'), cam.right);
    gl.uniform3fv(u('uUp'), cam.up);
    gl.uniform3fv(u('uBack'), cam.back);
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    gl.uniform1f(u('uFocal'), (0.5 * h) / tanHalf);
    gl.uniform1f(u('uOrtho'), cam.ortho ?? 0);
    gl.uniform1f(u('uOrthoH'), cam.orthoH ?? 5);
    gl.uniform1f(u('uFlat'), cam.flat ?? look.flat ?? 0);
    gl.uniform1i(u('uSS'), opts.samples ?? 1);
    gl.uniform1i(u('uDepth'), look.depth ?? 12);
    gl.uniform1f(u('uLine'), (opts.lineScale ?? 1) * (h / 1080));
    gl.uniform1f(u('uTint'), look.tint ?? 0.1);
    gl.uniform1f(u('uPassFade'), look.passFade ?? 1);
    gl.uniform1f(u('uThick'), look.rim ?? 0.035);
    gl.uniform1f(u('uRimBand'), look.rimBand ?? 0.02);
    gl.uniform1i(u('uPreciseRims'), look.preciseRims ? 1 : 0);
    gl.uniform1f(u('uSurfaceAlpha'), look.surfaceAlpha ?? 0);
    gl.uniform3fv(u('uLight'), look.lighting ?? [0.9, 0.1, 0]);
    gl.uniform1f(u('uDetail'), look.detail ?? 0);

    // rooms: the shot's room, plus any others (an outdoor space is a room with only a floor); each has its own sun
    const colour = (c, fallback) => hex(pal[c] ?? c ?? fallback);
    const rooms = (scene.rooms ?? [scene.room]).slice(0, MAXR);
    gl.uniform1i(u('uNR'), rooms.length);
    const marks = Array(MAXR * 6).fill(0);
    const sun = look.sun ?? [-0.45, 0.8, 0.4];
    rooms.forEach((room, r) => {
      gl.uniform3fv(u(`uRMin[${r}]`), room.min);
      gl.uniform3fv(u(`uRMax[${r}]`), room.max);
      const faces = room.faces ?? Object.keys(FACE_BIT);
      gl.uniform1i(u(`uRFaces[${r}]`), faces.reduce((m, f) => m | (1 << FACE_BIT[f]), 0));
      for (const [face, kind] of Object.entries(room.marks ?? {})) marks[r * 6 + FACE_BIT[face]] = MARKS[kind] ?? 0;
      gl.uniform1f(u(`uRGrid[${r}]`), room.grid ?? 0);
      // room.sunVia: {portal, sun}: the room sees the sun of the far side (sun, in that side's space) only through
      // `portal`; its direction here is that sun carried back through the pair
      const via = room.sunVia;
      const P = via ? (scene.portals ?? [])[via.portal] : null;
      if (P && Math.min(P.a, P.b) > 1e-3) {
        const Q = scene.portals[P.link];
        const s = via.sun;
        const sq = [s[0] * Q.u[0] + s[1] * Q.u[1] + s[2] * Q.u[2], s[0] * Q.v[0] + s[1] * Q.v[1] + s[2] * Q.v[2], s[0] * Q.n[0] + s[1] * Q.n[1] + s[2] * Q.n[2]];
        const ld = [-sq[0], sq[1], -sq[2]];
        gl.uniform3fv(u(`uRSun[${r}]`), [0, 1, 2].map((j) => ld[0] * P.u[j] + ld[1] * P.v[j] + ld[2] * P.n[j]));
        gl.uniform1i(u(`uRSunVia[${r}]`), via.portal);
      } else {
        gl.uniform3fv(u(`uRSun[${r}]`), room.sun ?? sun);
        gl.uniform1i(u(`uRSunVia[${r}]`), via ? -2 : -1);
      }
      gl.uniform3fv(u(`uRFloor[${r}]`), colour(room.floor, pal.floor));
      gl.uniform3fv(u(`uRWall[${r}]`), colour(room.wall, pal.wall));
      // look.walls: a preset name from the palette ("colour") or {face: colour}; room.walls overrides per room
      const walls = room.walls ?? (typeof look.walls === 'string' ? pal.walls?.[look.walls] : look.walls);
      for (const [face, bit] of Object.entries(FACE_BIT)) {
        const base = face === '-y' ? colour(room.floor, pal.floor) : colour(room.wall, pal.wall);
        gl.uniform3fv(u(`uRFace[${r * 6 + bit}]`), walls?.[face] ? colour(walls[face]) : base);
      }
      gl.uniform1f(u(`uRTint[${r}]`), walls ? (look.wallsShown ?? 1) : 0);
      gl.uniform1i(u(`uRIn[${r}]`), room.inside ? 1 : 0);
      gl.uniform1i(u(`uRSpace[${r}]`), room.space ?? -1);
      gl.uniform1i(u(`uRSky[${r}]`), room.sky ? 1 : 0);
      // a sun ring in the sky, angular radius in degrees
      gl.uniform1f(u(`uRDisc[${r}]`), ((room.sunDisc ?? 0) * Math.PI) / 180);
    });
    gl.uniform1iv(u('uMarks'), marks);

    const boxes = [
      ...scene.statics.map((s) => ({c: s.c, h: s.h, axes: s.axes ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]], color: s.color ?? pal.static, clip: s.clip ?? null, mark: s.mark, space: s.space})),
      ...scene.bodies.map((b) => ({...b, color: b.color ?? pal.body, mark: b.mark ?? 'square'})),
    ].slice(0, MAXB);
    gl.uniform1i(u('uNB'), boxes.length);
    boxes.forEach((b, i) => {
      gl.uniform3fv(u(`uBC[${i}]`), b.c);
      gl.uniform3fv(u(`uBH[${i}]`), b.h);
      gl.uniform3fv(u(`uBX[${i}]`), b.axes[0]);
      gl.uniform3fv(u(`uBY[${i}]`), b.axes[1]);
      gl.uniform3fv(u(`uBZ[${i}]`), b.axes[2]);
      gl.uniform3fv(u(`uBCol[${i}]`), hex(pal[b.color] ?? b.color));
      gl.uniform4fv(u(`uBClip[${i}]`), b.clip ?? [0, 0, 0, 0]);
      gl.uniform4fv(u(`uBClipSphere[${i}]`), b.clipSphere ?? [0, 0, 0, 0]);
      gl.uniform1i(u(`uBMark[${i}]`), b.mark === 'square' ? 1 : b.mark === 'ball' ? 2 : 0);
      gl.uniform1i(u(`uBSpace[${i}]`), b.space ?? -1);
    });

    const cards = (scene.cards ?? []).slice(0, MAXC);
    gl.uniform1i(u('uNC'), cards.length);
    cards.forEach((c, i) => {
      gl.uniform3fv(u(`uCC[${i}]`), c.c);
      gl.uniform3fv(u(`uCR[${i}]`), c.right);
      gl.uniform3fv(u(`uCU[${i}]`), c.up);
      gl.uniform4fv(u(`uCClip[${i}]`), c.clip ?? [0, 0, 0, 0]);
      gl.uniform1i(u(`uCL[${i}]`), c.layer ?? 0);
    });

    // capsules: {a, b, r, color, clip}
    const caps = (scene.capsules ?? []).slice(0, 256).sort((a, b) => (a.space ?? -1) - (b.space ?? -1));
    gl.uniform1i(u('uNK'), caps.length);
    const common = caps.filter((c) => (c.space ?? -1) < 0).length;
    gl.uniform1i(u('uCapsCommon'), common);
    gl.uniform1iv(u('uCapsStart'), Array.from({length: 4}, (_, i) => {
      const k = caps.findIndex((c) => c.space === i); return k < 0 ? common : k;
    }));
    gl.uniform1iv(u('uCapsEnd'), Array.from({length: 4}, (_, i) => {
      const start = caps.findIndex((c) => c.space === i); return start < 0 ? common : start + caps.filter((c) => c.space === i).length;
    }));
    // the sampler always has its own unit, so it never shares one with the card array
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, capTex);
    gl.uniform1i(u('uCaps'), 3);
    gl.activeTexture(gl.TEXTURE0);
    if (caps.length) {
      const cd = new Float32Array(caps.length * 16);
      caps.forEach((c, i) => {
        const col = hex(pal[c.color] ?? c.color ?? pal.ink);
        cd.set([...c.a, c.r, ...c.b, c.space ?? -1, ...col, 1, ...(c.clip ?? [0, 0, 0, 0])], i * 16);
      });
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, capTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, caps.length, 0, gl.RGBA, gl.FLOAT, cd);
      gl.uniform1i(u('uCaps'), 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    const triangles = (scene.triangles ?? []).slice(0, 512);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, triangleTex);
    gl.uniform1i(u('uTriangles'), 4);
    gl.uniform1i(u('uNT'), triangles.length);
    if (triangles.length) {
      const data = new Float32Array(triangles.length * 16);
      triangles.forEach((f, i) => data.set([...f.a, f.space ?? -1, ...f.b, 0, ...f.c, 0, ...hex(f.color), 1], i * 16));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, triangles.length, 0, gl.RGBA, gl.FLOAT, data);
    }
    gl.activeTexture(gl.TEXTURE0);

    // lines: {pts, color, width}; trails are lines in the trail colour
    const LINE_COLORS = ['trail', 'ink', 'red', 'blue', 'orange', 'field', 'snow', 'wall'];
    const lineColor = (c) => Math.max(0, LINE_COLORS.indexOf(c ?? 'trail'));
    const lines = [...(scene.trails ?? []).map((pts) => ({pts, color: 'trail', width: 1.6})), ...(scene.lines ?? [])].filter((l) => l.pts.length > 1);
    const nPts = lines.reduce((n, l) => n + l.pts.length, 0);
    const texels = 2 * lines.length + nPts;
    const rowsL = Math.max(1, Math.ceil(texels / LINE_W));
    const data = new Float32Array(rowsL * LINE_W * 4);
    let k = 2 * lines.length;
    lines.forEach((l, i) => {
      const c = [0, 1, 2].map((j) => l.pts.reduce((s, p) => s + p[j], 0) / l.pts.length);
      const r = Math.max(...l.pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
      data.set([...c, r], 8 * i);
      data.set([k, l.pts.length, lineColor(l.color), l.width ?? 1.6], 8 * i + 4);
      for (const p of l.pts) data.set([p[0], p[1], p[2], 0], 4 * k++);
    });
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lineTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LINE_W, rowsL, 0, gl.RGBA, gl.FLOAT, data);
    gl.uniform1i(u('uLines'), 2);
    gl.uniform1i(u('uNL'), lines.length);
    const named = {...pal, red: '#B23A4C', blue: PORTAL.blue, orange: PORTAL.orange, snow: '#F7F6EC'};
    gl.uniform3fv(u('uLineCol'), LINE_COLORS.flatMap((c) => hex(named[c])));

    // wormhole surfaces: {c, b, mix, R, rings, spokes}; the height of the sheets is where r(y) reaches R
    const surfs = (scene.surfaces ?? []).slice(0, MAXF);
    gl.uniform1i(u('uNF'), surfs.length);
    surfs.forEach((f, i) => {
      const m = f.mix ?? 0;
      const r = (y) => (1 - m) * (f.b + (y * y) / (4 * f.b)) + m * f.b * Math.cosh(Math.min(20, y / f.b));
      let lo = 0;
      let hi = 1;
      while (r(hi) < f.R && hi < 1e4) hi *= 2;
      for (let j = 0; j < 60; j++) (r((lo + hi) / 2) < f.R ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2));
      gl.uniform3fv(u(`uFC[${i}]`), f.c);
      gl.uniform1f(u(`uFB[${i}]`), f.b);
      gl.uniform1f(u(`uFMix[${i}]`), m);
      gl.uniform1f(u(`uFR[${i}]`), f.R);
      gl.uniform1f(u(`uFY[${i}]`), lo);
      gl.uniform1f(u(`uFRings[${i}]`), f.rings ?? 8);
      gl.uniform1f(u(`uFSpokes[${i}]`), f.spokes ?? 24);
    });
    gl.uniform3fv(u('uSurfCol'), hex(pal.wall));
    gl.uniform3fv(u('uSurfLine'), hex(pal.trail));

    const portals = scene.portals.slice(0, MAXP);
    gl.uniform1i(u('uNP'), portals.length);
    portals.forEach((p, i) => {
      gl.uniform3fv(u(`uPC[${i}]`), p.c);
      gl.uniform3fv(u(`uPU[${i}]`), p.u);
      gl.uniform3fv(u(`uPV[${i}]`), p.v);
      gl.uniform3fv(u(`uPN[${i}]`), p.n);
      gl.uniform2f(u(`uPAB[${i}]`), p.a, p.b);
      gl.uniform1f(u(`uPDome[${i}]`), p.surface?.renderDome ?? -(p.surface?.dome ?? 0));
      gl.uniform1i(u(`uPTwoSided[${i}]`), p.twoSided ? 1 : 0);
      gl.uniform1i(u(`uPSpace[${i}]`), p.space ?? -1);
      gl.uniform1i(u(`uPTargetSpace[${i}]`), p.targetSpace ?? -1);
      gl.uniform1i(u(`uPL[${i}]`), p.link);
      gl.uniform3fv(u(`uPCol[${i}]`), hex(PORTAL[p.color] ?? p.color));
      gl.uniform1f(u(`uPOpen[${i}]`), p.open ?? look.open ?? 1);
    });

    // look.field: {show: ["potential", "arrows", "strength"], step (potential per line), arrow (spacing), levels (in g)}
    const fs = F ? look.field ?? {} : {};
    const show = fs.show ?? [];
    gl.uniform1i(u('uFMode'), F ? (show.includes('potential') ? 1 : 0) | (show.includes('arrows') ? 2 : 0) | (show.includes('strength') ? 4 : 0) : 0);
    if (F) {
      gl.uniform2fv(u('uFOrigin'), F.origin);
      gl.uniform1f(u('uFCell'), F.cell);
      gl.uniform2i(u('uFSize'), F.w, F.h);
      gl.uniform1f(u('uFG'), F.g || 1);
      gl.uniform1f(u('uFStep'), fs.step ?? 0.5 * (F.g || 9.81));
      gl.uniform1f(u('uFArrow'), fs.arrow ?? 0.5);
      gl.uniform1f(u('uFArrowG'), fs.arrowG ?? 1);
      const levels = (fs.levels ?? [1, 2, 5, 10]).slice(0, 8);
      gl.uniform1i(u('uFNL'), levels.length);
      gl.uniform1fv(u('uFLevels'), [...levels, ...Array(8 - levels.length).fill(0)]);
    }
    gl.uniform3fv(u('uFieldCol'), hex(pal.field));
    gl.uniform1f(u('uFHeat'), F ? fs.heat ?? 0 : 0);
    gl.uniform1f(u('uFFlow'), F ? fs.flow ?? 0 : 0);
    gl.uniform1f(u('uFBands'), fs.bands ?? 10);
    gl.uniform1i(u('uFRamp'), fs.ramp === 'bold' ? 1 : 0);
    gl.uniform1i(u('uFRoom'), fs.room ?? 0);
    gl.uniform3fv(u('uHeatWeak'), hex(pal.heatWeak));
    gl.uniform3fv(u('uHeatStrong'), hex(pal.heatStrong));
    gl.uniform3fv(u('uHeatMax'), hex(pal.heatMax));

    for (const [name, key] of [['uBg', 'background'], ['uWall', 'wall'], ['uFloor', 'floor'], ['uInk', 'ink'], ['uDeep', 'deep'], ['uBack2', 'back'], ['uGridCol', 'grid'], ['uMarkCol', 'mark'], ['uSurface', 'wall']]) {
      gl.uniform3fv(u(name), hex(look[key] ?? pal[key]));
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {render, setCardImage, gl};
}
