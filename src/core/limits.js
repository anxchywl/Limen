// Centralized platform limits from research.md §6.
// Detects desktop vs phone and enforces bounds across tools, simulation, spawning and validation.

export const DESKTOP_LIMITS = Object.freeze({
  isMobile: false,
  maxBodies: 300,
  maxPortalPairs: 4,
  maxPortals: 8,
  maxDepth: 6,
  maxViews: 32,
  maxSpeed: 60, // m/s
  maxEmitters: 8,
  maxEmitterRate: 5, // per second
  defaultDprCap: 2.0,
});

export const PHONE_LIMITS = Object.freeze({
  isMobile: true,
  maxBodies: 120,
  maxPortalPairs: 4,
  maxPortals: 8,
  maxDepth: 3,
  maxViews: 12,
  maxSpeed: 60, // m/s
  maxEmitters: 4,
  maxEmitterRate: 5, // per second
  defaultDprCap: 1.5,
});

export function detectIsMobile() {
  if (typeof window === 'undefined') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const lowCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency <= 4;
  const smallScreen = typeof window.innerWidth === 'number' && window.innerWidth <= 640;
  return Boolean(coarse || (lowCores && smallScreen));
}

let activeOverride = null; // null = auto, true = force phone, false = force desktop

export function setMobileOverride(mobile) {
  activeOverride = mobile === null ? null : Boolean(mobile);
}

export function getLimits() {
  const isMob = activeOverride !== null ? activeOverride : detectIsMobile();
  return isMob ? PHONE_LIMITS : DESKTOP_LIMITS;
}

export function canAddBody(doc) {
  const lim = getLimits();
  const liveCount = (doc.bodies ?? []).filter((b) => !b._dead).length;
  if (liveCount >= lim.maxBodies) {
    return {ok: false, reason: `Body limit reached (${lim.maxBodies} max)`};
  }
  return {ok: true};
}

export function canAddPortalPair(doc) {
  const lim = getLimits();
  const pairs = Math.floor((doc.portals ?? []).length / 2);
  if (pairs >= lim.maxPortalPairs) {
    return {ok: false, reason: `Portal pair limit reached (${lim.maxPortalPairs} pairs max)`};
  }
  return {ok: true};
}

export function canAddEmitter(doc) {
  const lim = getLimits();
  const emitters = doc.emitters ?? [];
  if (emitters.length >= lim.maxEmitters) {
    return {ok: false, reason: `Emitter limit reached (${lim.maxEmitters} max)`};
  }
  return {ok: true};
}
