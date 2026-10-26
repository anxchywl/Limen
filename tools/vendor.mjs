// Copies the few pinned dependency files Limen needs from node_modules into vendor/.
// There is no build step: the browser loads these through the import map in index.html.
// Run after `npm install`: `node tools/vendor.mjs`.

import {cpSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'vendor', p);

const PINS = {
  three: '0.187.0',
  '@dimforge/rapier3d-simd-compat': '0.21.0',
  '@dimforge/rapier3d-compat': '0.21.0',
};

// [from in node_modules, to in vendor]
const FILES = [
  ['three/build/three.module.js', 'three/three.module.js'],
  ['three/build/three.core.js', 'three/three.core.js'],
  ['three/LICENSE', 'three/LICENSE'],
  ['three/examples/jsm/controls/OrbitControls.js', 'three/addons/controls/OrbitControls.js'],
  ['three/examples/jsm/controls/TransformControls.js', 'three/addons/controls/TransformControls.js'],
  // the compat builds inline the wasm as base64, so one .mjs each is the whole engine
  ['@dimforge/rapier3d-simd-compat/dist/rapier.mjs', 'rapier/simd/rapier.mjs'],
  ['@dimforge/rapier3d-simd-compat/LICENSE', 'rapier/simd/LICENSE'],
  ['@dimforge/rapier3d-compat/dist/rapier.mjs', 'rapier/compat/rapier.mjs'],
  ['@dimforge/rapier3d-compat/LICENSE', 'rapier/compat/LICENSE'],
];

for (const [name, want] of Object.entries(PINS)) {
  const got = JSON.parse(readFileSync(nm(`${name}/package.json`), 'utf8')).version;
  if (got !== want) throw new Error(`${name} is ${got}, pinned ${want}; run npm install`);
}

rmSync(join(root, 'vendor'), {recursive: true, force: true});
for (const [from, to] of FILES) {
  mkdirSync(dirname(out(to)), {recursive: true});
  cpSync(nm(from), out(to));
}
console.log(`vendored ${FILES.length} files: ${Object.entries(PINS).map(([n, v]) => `${n}@${v}`).join(', ')}`);
