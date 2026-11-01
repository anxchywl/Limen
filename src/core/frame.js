// The frame buffer layout shared by the sim and render.
// One Float32Array per physics step: an 8-float header, then 16 floats per body slot.
// Prompt 03 re-exports this from src/physics/protocol.js; prompt 07 adds worker timing fields.

export const HEADER = 8;            // [step, time, live count, slot span, stepMs, transitMs, inTransit, spare]
export const H_STEP = 0, H_TIME = 1, H_COUNT = 2, H_SLOTS = 3;
export const H_STEP_MS = 4, H_TRANSIT_MS = 5, H_IN_TRANSIT = 6, H_SPARE = 7;
export const STRIDE = 16;
export const POS = 0, QUAT = 3, FLAGS = 7, CLONE_POS = 8, CLONE_QUAT = 11, SPARE = 15;

export const ALIVE = 1, HAS_CLONE = 2;
export const TELEPORT_SHIFT = 8;    // bits 8-15: index + 1 of the portal entered this step, 0 = none

export const frameLength = (slots) => HEADER + slots * STRIDE;
export const slotOffset = (i) => HEADER + i * STRIDE;
export const teleportOf = (flags) => ((flags >> TELEPORT_SHIFT) & 0xff) - 1;
export const withTeleport = (flags, portal) => (flags & ~(0xff << TELEPORT_SHIFT)) | ((portal + 1) << TELEPORT_SHIFT);
