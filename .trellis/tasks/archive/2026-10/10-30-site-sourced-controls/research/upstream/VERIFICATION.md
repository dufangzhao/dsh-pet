# Verification, access limits, and licence evidence

Retrieved 2026-10-30 (Asia/Taipei) by the source-research owner. No product UI was written by this task.

## What is adopted, and its provenance

Five published components by **andrew-demchenk0**, kept byte-exact from the official Uiverse archive:
`uiverse-io/galaxy@adbd2adde0a299a3956ea288fb444ec01891ca41` (single pinned revision, repo `pushed_at` 2024-09-02T14:32:05Z).
Per-component author + licence notes: `notices/<slug>.md`.

## Licence evidence

- Upstream `LICENSE` retained byte-exact at `galaxy/LICENSE.md` — **MIT**, `Copyright (c) 2023 Uiverse.io`. Condition: the copyright notice and permission notice stay in all copies / substantial portions.
- Each retained component file still contains its own in-file author notice, e.g.
  `/* From Uiverse.io by andrew-demchenk0 - Tags: blue, switch, on, off, toggle, text animation, switcher, color, text, toggle switch */`
  This is the individual author attribution Uiverse publishes per component. Uiverse does **not** publish a separate per-author licence file; the repo-level MIT plus the per-item attribution comment is the complete published notice, and both are retained here.
- Adaptation is permitted by that licence (use, copy, modify, merge, publish, distribute). Our planned changes are itemised in `../source-selection.md`.

## Access limitation, recorded honestly (not bypassed)

- `https://uiverse.io/` and `https://uiverse.io/andrew-demchenk0/<slug>` return **HTTP 403 "Attention Required! | Cloudflare"** from this environment — both to plain HTTP clients (Node fetch, curl) and to a normal headless Chromium session. This is an IP/edge block, not a login or paywall. **No bypass was attempted**: no challenge solving, no proxy, no rotation, no credentials.
  Evidence: `page-captures/uiverse-io_cloudflare-block_permalink.png`, `page-captures/uiverse-io_cloudflare-block_home.png`.
- The permalink slug is nevertheless derived from the archive's own published naming rule `<Category>/<author>_<slug>.html`, and the retained header comment in each raw file states "From Uiverse.io by andrew-demchenk0", matching the archive README: "Every single UI element you find in here is sourced from our main platform, Uiverse.io."
- Therefore the **primary source evidence for adoption is the pinned official archive**, viewed publicly at the exact revision in a normal browser (no block):
  `page-captures/galaxy-pinned-afraid-squid-51.png`, `galaxy-pinned-polite-stingray-67.png`, `galaxy-pinned-empty-penguin-100.png`.
- If the live site becomes reachable later, re-confirm the three core permalinks and add their captures under `page-captures/` — the SHA-256 values below should still match, since the pinned revision is immutable.

## Local rendering proof, CSS-only, zero external assets

`render-check/index.html` renders all five components offline from self-contained `srcdoc`, each captioned with the SHA-256 its content decodes to. Verified in Chromium: 5/5 frames paint (button shows "Let`s go →", choice shows three options, panel shows its two faces). Nothing was stripped to achieve this — the published files contain no `@import`, no `url(http...)
`, no CDN font, no `<script>`. Proof: `page-captures/local-render-raw5-offline.png`.

## Frozen inventory (any change to these hashes breaks the freeze)

| File | Size | SHA-256 |
| --- | --- | --- |
| `render-check/index.html` | 13056 B | `67c873d6c9478c83…` |
| `galaxy/LICENSE.md` | 1067 B | `7feadcd7a611d37a…` |
| `galaxy/README.md` | 1790 B | `9ba53017977494b2…` |
| `manifest.json` | 5604 B | `998beec539eb0ac9…` |
| `raw/Buttons/andrew-demchenk0_afraid-squid-51.html` | 593 B | `11cfdd7d14b5b7c3…` |
| `raw/Inputs/andrew-demchenk0_polite-stingray-67.html` | 704 B | `02e77dbd3c0a45d5…` |
| `raw/Toggle-switches/andrew-demchenk0_empty-penguin-100.html` | 1527 B | `4a3cb08d7e468483…` |
| `raw/Radio-buttons/andrew-demchenk0_stupid-seahorse-9.html` | 1571 B | `d0b435d6c672d2ae…` |
| `raw/Forms/andrew-demchenk0_afraid-cougar-9.html` | 5321 B | `791fda9edbce04a8…` |
| `notices/afraid-squid-51.md` | 1357 B | `ae2d06254a0bce98…` |
| `notices/polite-stingray-67.md` | 1329 B | `377b3beaec52c004…` |
| `notices/empty-penguin-100.md` | 1466 B | `6ba9b2e9f139698f…` |
| `notices/stupid-seahorse-9.md` | 1424 B | `f8ab535514144133…` |
| `notices/afraid-cougar-9.md` | 1577 B | `9d9b2e2cdebb536d…` |
| `page-captures/galaxy-pinned-afraid-squid-51.png` | 77943 B | `cf5e21b10c540a32…` |
| `page-captures/galaxy-pinned-polite-stingray-67.png` | 77662 B | `346757c1075a9b19…` |
| `page-captures/galaxy-pinned-empty-penguin-100.png` | 74700 B | `7abf0eb1ddf1c593…` |
| `page-captures/local-render-raw5-offline.png` | 54147 B | `be5b82f4a71363c1…` |
| `page-captures/uiverse-io_cloudflare-block_permalink.png` | 30200 B | `f85b102278603563…` |
| `page-captures/uiverse-io_cloudflare-block_home.png` | 30200 B | `f85b102278603563…` |

Upstream artefacts: tarball `https://codeload.github.com/uiverse-io/galaxy/tar.gz/adbd2adde0a299a3956ea288fb444ec01891ca41`, SHA-256 `1185545d18507404af8037fbac09eaf3b2f8071090d8a7eb8934a80627dab4da` (2 434 859 B).
