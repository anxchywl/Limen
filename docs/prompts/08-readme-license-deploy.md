# 08: README, licence and deploy

You are finishing Limen in `~/limen`. First read `docs/prompts/00-overview.md` and `docs/progress.md`, then `docs/research.md` §7 "License" and "Hosting". The user's repo conventions: single-word Latin PascalCase repo names, short lowercase descriptions with topics, scoped lowercase conventional commits. READMEs have a title, one plain paragraph, then Features, Getting started, Limits, License ("[MIT](LICENSE)", "Copyright (c) 2026 anxchywl").

## Previous steps

01–07 produced the full sandbox, hardened and measured (`docs/perf-report.md`). It is local only: no remote, nothing pushed.

## Scope

1. **`README.md`** in the user's layout:
   - **Opening.** The title `Limen` and one plain paragraph on what it is: place linked portals, build, spawn, and watch real physics carry things through. Mention that it grew out of the lab behind the portals film by @anxchywl.
   - **Features:** a short list of real features only.
   - **Getting started:** `python3 -m http.server 5180`; the controls.
   - **Limits:** honest ones, taken from progress.md. Examples:
     - one transit per body at a time
     - pairs share one size
     - portals only on static blocks
     - the ghost approximation on the far side
     - caps on bodies and recursion
   - **License.**

   One screenshot or GIF from a gallery scene in `docs/media/`. No marketing tone and no emoji.
2. **`LICENSE`:** MIT, "Copyright (c) 2026 anxchywl". Do this only if the user confirmed MIT; otherwise ask the user once and wait.
3. **`THIRD_PARTY_LICENSES.txt`:** the three.js MIT licence and the Rapier Apache-2.0 licence, with their copyright lines, copied from the vendored packages. Also any code adapted from three.js examples (the oblique projection from `Reflector.js`). Ianua is the user's own MIT code; credit it in a comment, no notice needed.
4. **Deploy files:**
   - `CNAME` with `limen.anxchywl.dev` (only if the user confirmed the name and domain)
   - `.nojekyll`
   - `404.html` redirecting to `/` with the hash preserved
   - `<meta>` description and Open Graph image
   - a favicon in the palette

   Check every asset path is relative, so it works under a subpath too.
5. **Pre-flight:**
   - every test passes: `node tests/*.mjs`
   - the stress reports are current
   - the console is clean on load
   - Lighthouse runs (note performance and accessibility scores)
   - the site works from a plain static server rooted at the repo (no dev-only paths)
   - `vendor/` contains only what is used
6. **Publish only with the user's explicit OK.** Prepare the commands, but do not run them until the user says so in this session:
   - `gh repo create anxchywl/Limen --public --source . --description "..." --push`
   - set the topics
   - enable Pages from the default branch root with the custom domain
   - DNS: a CNAME record `limen` → `anxchywl.github.io` at name.com, done by the user
   - enforce HTTPS after the certificate is issued

## Files you own

`README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.txt`, `CNAME`, `.nojekyll`, `404.html`, `docs/media/**`, and the head metadata and favicon in `index.html`.

## Do not touch

App code, unless pre-flight finds a bug; fix it with its own scoped commit. Also `docs/research.md` and `docs/prompts/*`.

## Acceptance

- [ ] README reads in the user's style: plain, short, every feature real, limits honest.
- [ ] Licence files are correct and complete for everything vendored.
- [ ] Pre-flight passes. Lighthouse numbers recorded in progress.md.
- [ ] Commit, for example `docs: readme, licence and third-party notices` and `chore: pages deploy files`.
- [ ] Ask the user for the go-ahead to create the GitHub repo and push. Report the exact commands and the DNS step they must do.
