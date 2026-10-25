# 06: save, load and share

You are continuing Limen in `~/limen`. First read `docs/prompts/00-overview.md` and `docs/progress.md`, then `docs/research.md` §7 "Save, load, share".

## Previous steps

01–05 produced a working sandbox: the scene document drives rendering and the physics worker; an editor with edit and play modes, tools, undo and a fly camera. Nothing persists yet.

## Scope

1. **Serialization** (`src/io/serialize.js`):
   - `toJSON(scene)` writes only document fields, never runtime state.
   - Quantize positions to 1 mm, angles to 0.1° (quaternions stored as such, rounded to 4 decimals) and colours to palette indices where possible.
   - `fromJSON(text)` parses, **validates** and returns a clean document, or a list of errors.
2. **Validation** (`src/io/validate.js`). Shared links are untrusted input. Check:
   - the version (accept 1; reject unknown with a message)
   - types and finite numbers
   - limits clamped (bodies, portals, emitters, sizes, speeds)
   - ids unique and references existing (portal → block, pair partner)
   - total size ≤ 1 MB

   Never `eval`. Never set HTML from document text. Names are shown with `textContent`.
3. **Share link** (`src/io/share.js`):
   - Encode as JSON → `CompressionStream('deflate-raw')` → base64url → `location.hash = '#s=' + data`. Decode on load and on `hashchange`.
   - If the link exceeds 8 KB, warn and offer a file instead.
   - A Share button copies the link (Clipboard API, falling back to a selectable field).
4. **Files.** Download the scene as `name.limen.json`; open one through a file picker or by dropping it on the canvas.
5. **Autosave.** Autosave the document to `localStorage` (debounced 1 s, try/catch) and restore it on start if there is no share hash. "New scene" asks before discarding.
6. **Gallery** (`scenes/*.json` plus `scenes/index.json`). Six to eight hand-built example scenes that show off portals:
   - endless fall
   - fling (a body dropped in gains height through a raised exit)
   - a ball loop machine
   - a stack through a wall portal
   - a recursive corridor (pairs facing)
   - a portal staircase
   - a domino run through portals
   - a sandbox starter room

   Build each with the editor, save it, check that it plays well, and give it a short title. A gallery panel loads them.
7. **Tests** (`tests/io.mjs`):
   - round trip: document → JSON → document is equal after quantization
   - share-encode and share-decode round trip; the compressed size of the gallery scenes is printed
   - the validator rejects at least ten malformed or hostile inputs: NaN, huge arrays, missing partner, unknown version, a 10 MB string, prototype-pollution keys (`__proto__`)

## Files you own

`src/io/**`, `scenes/**`, `tests/io.mjs`, the Share/Open/Save/Gallery buttons in `src/ui/` (add them; do not restyle the existing UI), and the start-up order in `src/main.js` (hash > autosave > default).

## Do not touch

`src/physics/*`, `src/render/*`, the editor tools, `docs/research.md` and `docs/prompts/*`.

## Acceptance

- [ ] `node tests/io.mjs` passes.
- [ ] Build a scene, press Share, open the link in a new tab: an identical scene, and Play gives the same motion for 5 s (same machine).
- [ ] Each gallery scene loads in < 300 ms and plays at budget on the desktop reference. Note anything heavy.
- [ ] Hostile hash (paste a crafted `#s=` with a huge or invalid payload): a clean error message and the previous scene intact. No freeze over 100 ms.
- [ ] Reloading the page restores the autosaved scene. With `localStorage` blocked (a private window), the app still works.
- [ ] Update `docs/progress.md`, including the gallery list and link sizes.
- [ ] Commit, for example `feat(io): json files, compressed share links, autosave and an example gallery`.
