// The paper-and-ink look as a patch on MeshLambertMaterial (soft, cheap, shadowed).
// Ink lines are drawn in the fragment shader at a constant pixel width, using fwidth:
//   'faces'  flat faces: aEdge holds the distances (metres) to up to four face borders, which
//            interpolate exactly across a planar face, so borders ink however a face is split
//   'round'  balls and capsules: a silhouette rim, plus an equator and a meridian so spin reads
// Instanced meshes also get aClip, a per-instance world plane (n, w): fragments with n.p + w < 0
// are discarded, (0,0,0,0) keeps everything. Prompt 02 uses it for bodies sliced by a portal.
// 'capsule' rebuilds a round-capped capsule of any length from one shared mesh and the instance scale.

import * as THREE from 'three';

const VERT_PARS = /* glsl */`
#ifdef INK_FACES
attribute vec4 aEdge;
varying vec4 vInkEdge;
#endif
#ifdef INK_ROUND
varying vec3 vInkLocal;
#endif
#ifdef INK_CLIP
attribute vec4 aClip;
varying float vInkClip;
#endif
`;

// capsule: the mesh is a unit-diameter sphere split at y = 0; push each half out along y so the
// body's (d, h, d) instance scale gives round caps of diameter d and total height h
const CAPSULE_NORMAL = /* glsl */`
#if defined(INK_CAPSULE) && defined(USE_INSTANCING)
  vec3 inkS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  objectNormal *= inkS; // pre-scale so three's inverse-scale normal transform gives the true normal
#endif
`;

const CAPSULE_POS = /* glsl */`
#if defined(INK_CAPSULE) && defined(USE_INSTANCING)
  {
    vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    float r = min(s.x, s.z);
    transformed.y = (r * position.y + sign(position.y) * max(s.y - r, 0.0) * 0.5) / s.y;
  }
#endif
`;

const VERT_MAIN = /* glsl */`
#ifdef INK_FACES
  vInkEdge = aEdge;
#endif
#if defined(INK_ROUND) || defined(INK_CLIP)
  vec4 inkWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    inkWorld = instanceMatrix * inkWorld;
  #endif
#endif
#ifdef INK_ROUND
  vec3 inkScale = vec3(1.0);
  #ifdef USE_INSTANCING
    inkScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  #endif
  vInkLocal = transformed * inkScale;
#endif
#ifdef INK_CLIP
  inkWorld = modelMatrix * inkWorld;
  vInkClip = (aClip.x == 0.0 && aClip.y == 0.0 && aClip.z == 0.0) ? 1.0 : dot(aClip.xyz, inkWorld.xyz) + aClip.w;
#endif
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uInk;
uniform float uInkWidth;
uniform vec3 uPassTint;
#ifdef INK_FACES
varying vec4 vInkEdge;
#endif
#ifdef INK_ROUND
varying vec3 vInkLocal;
#endif
#ifdef INK_CLIP
varying float vInkClip;
#endif
float inkLine(float d) { return 1.0 - smoothstep(uInkWidth - 0.75, uInkWidth + 0.75, d); }
`;

const FRAG_CLIP = /* glsl */`
#ifdef INK_CLIP
  if (vInkClip < 0.0) discard;
#endif
`;

const FRAG_INK = /* glsl */`
{
  float ink = 0.0;
#ifdef INK_FACES
  vec4 px = vInkEdge / max(fwidth(vInkEdge), vec4(1e-6));
  ink = inkLine(min(min(px.x, px.y), min(px.z, px.w)));
#endif
#ifdef INK_ROUND
  vec3 n = normalize(normal);
  float facing = abs(dot(n, normalize(vViewPosition)));
  ink = inkLine(facing / max(fwidth(facing), 1e-6) * 0.6);
  ink = max(ink, inkLine(abs(vInkLocal.y) / max(fwidth(vInkLocal.y), 1e-6)));
  ink = max(ink, inkLine(abs(vInkLocal.x) / max(fwidth(vInkLocal.x), 1e-6)));
#endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, ink) * uPassTint;
}
`;

function patch(shader, defines) {
  shader.defines = {...shader.defines, ...defines};
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${CAPSULE_NORMAL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CAPSULE_POS}\n${VERT_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_CLIP}`);
}

// mode 'faces' | 'round'; capsule and clip are flags. Extra GLSL defines are set per material.
export function inkMaterial({mode = 'faces', capsule = false, clip = false, ink, width = 0.6, ...params} = {}) {
  const m = new THREE.MeshLambertMaterial({
    stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: 0, ...params,
  });
  const defines = {[mode === 'round' ? 'INK_ROUND' : 'INK_FACES']: ''};
  if (capsule) defines.INK_CAPSULE = '';
  if (clip) defines.INK_CLIP = '';
  const uniforms = {
    uInk: {value: new THREE.Color(ink)},
    uInkWidth: {value: width},
    uPassTint: {value: new THREE.Color(1, 1, 1)},
  };
  m.userData.ink = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patch(shader, defines);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${FRAG_INK}`);
  };
  m.customProgramCacheKey = () => `ink-${Object.keys(defines).join('-')}`;
  return m;
}

// the shadow pass needs the same capsule shape and clip plane, or slices would cast whole shadows
export function inkDepthMaterial({capsule = false, clip = false} = {}) {
  const m = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking});
  const defines = {};
  if (capsule) defines.INK_CAPSULE = '';
  if (clip) defines.INK_CLIP = '';
  m.onBeforeCompile = (shader) => patch(shader, defines);
  m.customProgramCacheKey = () => `inkdepth-${Object.keys(defines).join('-')}`;
  return m;
}
