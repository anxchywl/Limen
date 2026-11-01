// Unit test suite for Limen prompt 06 (IO):
// Serialization round-trip, share link compression/decompression,
// rejection of 10+ hostile/malformed inputs, and gallery scenes benchmark.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {defaultScene} from '../src/core/scene.js';
import {toJSON, fromJSON, quantize} from '../src/io/serialize.js';
import {validate} from '../src/io/validate.js';
import {encodeShare, decodeShare, buildShareUrl} from '../src/io/share.js';

console.log('Running Limen IO test suite...');

// 1. Serialization round trip
{
  const original = defaultScene();
  const json = toJSON(original);
  const parsed = fromJSON(json);
  assert.equal(parsed.ok, true, 'fromJSON succeeded on default scene');

  const roundTripDoc = parsed.doc;
  assert.equal(roundTripDoc.version, 1);
  assert.equal(roundTripDoc.blocks.length, original.blocks.length);
  assert.equal(roundTripDoc.portals.length, original.portals.length);
  assert.equal(roundTripDoc.bodies.length, original.bodies.length);

  // Compare quantized fields
  for (let i = 0; i < roundTripDoc.blocks.length; i++) {
    const b0 = original.blocks[i];
    const b1 = roundTripDoc.blocks[i];
    assert.equal(b1.id, b0.id);
    assert.equal(b1.kind, b0.kind ?? 'box');
  }
  for (let i = 0; i < roundTripDoc.portals.length; i++) {
    const p0 = original.portals[i];
    const p1 = roundTripDoc.portals[i];
    assert.equal(p1.id, p0.id);
    assert.equal(p1.pair, p0.pair);
    assert.deepEqual(p1.c, quantize(p0.c, 3));
  }
  console.log('  ✓ Serialization round-trip check passed');
}

// 2. Share compression and decompression round-trip on gallery scenes
{
  const galleryIndex = JSON.parse(fs.readFileSync('scenes/index.json', 'utf8'));
  assert.equal(galleryIndex.length >= 6, true, 'at least 6 gallery scenes defined');
  console.log(`  Checking ${galleryIndex.length} gallery scenes:`);

  for (const item of galleryIndex) {
    const raw = fs.readFileSync(item.file, 'utf8');
    const t0 = performance.now();
    const parsed = fromJSON(raw);
    const parseMs = performance.now() - t0;
    assert.equal(parsed.ok, true, `Gallery scene ${item.id} validated`);
    assert(parseMs < 300, `Parse time ${parseMs.toFixed(2)} ms < 300 ms budget`);

    // Share encode/decode
    const b64url = await encodeShare(parsed.doc);
    const decoded = await decodeShare(b64url);
    assert.equal(decoded.ok, true, `Share decode succeeded for ${item.id}`);
    assert.equal(decoded.doc.blocks.length, parsed.doc.blocks.length);
    assert.equal(decoded.doc.portals.length, parsed.doc.portals.length);
    assert.equal(decoded.doc.bodies.length, parsed.doc.bodies.length);

    const shareUrl = await buildShareUrl(parsed.doc);
    assert.equal(shareUrl.warning, null, `Share URL within 8 KB budget for ${item.id}`);

    console.log(`    - [${item.id}] "${item.title}": json ${raw.length} B -> compressed b64 ${b64url.length} B (${(parseMs).toFixed(2)} ms)`);
  }
  console.log('  ✓ Gallery scenes validation & compression round-trip passed');
}

// 3. Validator rejects at least ten malformed or hostile inputs
{
  const hostileTests = [
    {
      name: '1. Payload size > 1 MB',
      input: '{"version": 1, "junk": "' + 'x'.repeat(1024 * 1024 + 10) + '"}',
      expectedSubstr: '1 MB',
    },
    {
      name: '2. Prototype pollution (__proto__)',
      input: '{"version": 1, "__proto__": {"polluted": true}}',
      expectedSubstr: 'forbidden property key',
    },
    {
      name: '3. Prototype pollution (constructor)',
      input: '{"version": 1, "constructor": {"polluted": true}}',
      expectedSubstr: 'forbidden property key',
    },
    {
      name: '4. Unknown document version (99)',
      input: '{"version": 99, "blocks": []}',
      expectedSubstr: 'Unsupported scene version',
    },
    {
      name: '5. NaN in block coordinates',
      input: '{"version": 1, "blocks": [{"id": "k1", "kind": "box", "min": [NaN, 0, 0], "max": [1, 1, 1]}]}',
      expectedSubstr: 'Invalid JSON',
    },
    {
      name: '6. Non-finite numbers in body pos',
      input: '{"version": 1, "bodies": [{"id": "b1", "shape": "box", "pos": [0, "bad", 0], "size": [1,1,1]}]}',
      expectedSubstr: 'finite 3D vectors',
    },
    {
      name: '7. Missing portal partner reference',
      input: '{"version": 1, "portals": [{"id": "p1", "pair": "p_ghost", "c": [0,0,0], "n": [0,1,0], "v": [1,0,0]}]}',
      expectedSubstr: 'missing pair partner',
    },
    {
      name: '8. Duplicate entity IDs',
      input: '{"version": 1, "blocks": [{"id": "dup", "min": [0,0,0], "max": [1,1,1]}], "bodies": [{"id": "dup", "shape": "box", "pos": [0,0,0], "size": [1,1,1]}]}',
      expectedSubstr: 'Duplicate entity id',
    },
    {
      name: '9. Invalid body shape (banana)',
      input: '{"version": 1, "bodies": [{"id": "b1", "shape": "banana", "pos": [0,0,0], "size": [1,1,1]}]}',
      expectedSubstr: 'invalid shape',
    },
    {
      name: '10. Huge hostile array (> 1000 bodies)',
      input: JSON.stringify({
        version: 1,
        bodies: Array.from({length: 1500}, (_, i) => ({
          id: `b_${i}`, shape: 'ball', pos: [0, 1, 0], size: [0.5, 0.5, 0.5]
        }))
      }),
      expectedSubstr: 'Excessive body count',
    },
    {
      name: '11. Non-array blocks',
      input: '{"version": 1, "blocks": "not_an_array"}',
      expectedSubstr: 'blocks must be an array',
    },
    {
      name: '12. Malformed JSON syntax',
      input: '{"version": 1, "blocks": [',
      expectedSubstr: 'Invalid JSON',
    },
  ];

  for (const test of hostileTests) {
    const res = validate(test.input);
    assert.equal(res.ok, false, `Expected failure for: ${test.name}`);
    const errText = `${res.error} ${res.errors?.join(' ')}`;
    assert(
      errText.toLowerCase().includes(test.expectedSubstr.toLowerCase()),
      `Expected error message matching "${test.expectedSubstr}", got: "${errText}"`
    );
    console.log(`    ✓ Rejected ${test.name}: ${res.error}`);
  }
  console.log(`  ✓ All ${hostileTests.length} hostile/malformed inputs correctly rejected`);
}

console.log('All Limen IO unit tests PASSED cleanly!');
