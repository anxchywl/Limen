// The frame buffer layout shared by the sim (stub now, the Rapier worker from prompt 03) and render.
// One Float32Array per physics step: a small header, then 16 floats per body slot.
// Prompt 03 re-exports this from src/physics/protocol.js; later prompts only use SPARE and flag bits.

export const HEADER = 4;            // [step index, physics time, slot count, spare]
export const H_STEP = 0, H_TIME = 1, H_COUNT = 2;
export const STRIDE = 16;
export const POS = 0, QUAT = 3, FLAGS = 7, CLONE_POS = 8, CLONE_QUAT = 11, SPARE = 15;

export const ALIVE = 1, HAS_CLONE = 2;
export const TELEPORT_SHIFT = 8;    // bits 8-15: index + 1 of the portal entered this step, 0 = none

export const frameLength = (slots) => HEADER + slots * STRIDE;
export const slotOffset = (i) => HEADER + i * STRIDE;
export const teleportOf = (flags) => ((flags >> TELEPORT_SHIFT) & 0xff) - 1;
export const withTeleport = (flags, portal) => (flags & ~(0xff << TELEPORT_SHIFT)) | ((portal + 1) << TELEPORT_SHIFT);
