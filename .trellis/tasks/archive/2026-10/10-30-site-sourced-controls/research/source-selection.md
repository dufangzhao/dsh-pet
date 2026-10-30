# Source selection — one website-sourced control basis

**Decision (frozen):** adopt the **andrew-demchenk0 Uiverse control vocabulary** as the single foundation for the Chinese desktop-pet Start page and shared settings frame. Five real, already-published components by one author, one MIT license, one shared visual DNA. No original kit, no "inspired by" styling.

- Basis author: `andrew-demchenk0` — https://uiverse.io/andrew-demchenk0
- Upstream: `uiverse-io/galaxy` @ `adbd2adde0a299a3956ea288fb444ec01891ca41` (repo pushed_at 2024-09-02T14:32:05Z)
- License: MIT, "Copyright (c) 2023 Uiverse.io" — full text kept at `upstream/galaxy/LICENSE.md`
- Raw pack: `upstream/manifest.json` · `upstream/raw/` · `upstream/notices/` · `upstream/render-check/index.html` (offline sample of all five) · `upstream/VERIFICATION.md` (access limits + licence evidence)

## Why this basis is coherent — stated exactly, no invented system

This is a group of individually published components by one author that share one visible grammar. What is genuinely common to all five, verbatim from the retained raw sources:

```css
--bg-color: #fff;          /* surface */
--main-color: #323232;     /* ink / outline / shadow */
border: 2px solid var(--main-color);
box-shadow: 4px 4px var(--main-color);   /* hard offset, zero blur */
```

And the same three behaviour rules: press collapses the shadow (`box-shadow: 0px 0px` + `transform: translate(3px, 3px)`), the active/checked state swaps to the blue accent `#2d8cf0`, and motion is `transition: 0.3s` at weight-600, 15–17px type.

**Not claimed:** the token block is not identical file to file — each control declares only the subset it uses (the button declares `--font-color`; the switch adds `--bg-color-alt` and `--input-out-of-focus`; the radio group uses `--font-color-dark/light`; the form panel declares all six). `#2d8cf0` appears in three of the five, not the button. Radius is **role-specific geometry as published, and must stay that way** — do not flatten it to one value:

| Control | Published geometry |
| --- | --- |
| button `afraid-squid-51` | 120×40, `border-radius: 5px` |
| input `polite-stingray-67` | 200×40, `border-radius: 5px` |
| switch `empty-penguin-100` | 70×36 track, `border-radius: 100px` track and 30px knob |
| choice `stupid-seahorse-9` | 250×36 group, `border-radius: 34px` group, 50px per option |
| panel `afraid-cougar-9` | panel `border-radius: 5px`, square 20px knob `border-radius: 5px` |

The character of the set is the light "paper + ink" surface with a blunt 2px outline and an offset shadow that collapses when pressed — that border/shadow/colour/press grammar is the coherence, not a uniform radius. Uiverse publishes these as separate items, so this is five real components sharing one vocabulary, **not** an official design system.

## Adopted components (exact permalinks + retained raw)

Core — the three the interface needs today:

| # | Role | Uiverse permalink | Retained raw (byte-exact) | Bytes | SHA-256 (prefix) |
| --- | --- | --- | --- | --- | --- |
| 1 | button | https://uiverse.io/andrew-demchenk0/afraid-squid-51 | `upstream/raw/Buttons/andrew-demchenk0_afraid-squid-51.html` | 593 | `11cfdd7d14b5b7c3` |
| 2 | input | https://uiverse.io/andrew-demchenk0/polite-stingray-67 | `upstream/raw/Inputs/andrew-demchenk0_polite-stingray-67.html` | 704 | `02e77dbd3c0a45d5` |
| 3 | switch | https://uiverse.io/andrew-demchenk0/empty-penguin-100 | `upstream/raw/Toggle-switches/andrew-demchenk0_empty-penguin-100.html` | 1527 | `4a3cb08d7e468483` |

Additionally adopted source components — also the author's own published originals, not our designs:

| # | Role | Permalink | Retained raw | Bytes | SHA-256 (prefix) |
| --- | --- | --- | --- | --- | --- |
| 4 | choice (segmented radio group, adopted source) | https://uiverse.io/andrew-demchenk0/stupid-seahorse-9 | `upstream/raw/Radio-buttons/andrew-demchenk0_stupid-seahorse-9.html` | 1571 | `d0b435d6c672d2ae` |
| 5 | panel/card (+ square toggle + button + input, composite, adopted source) | https://uiverse.io/andrew-demchenk0/afraid-cougar-9 | `upstream/raw/Forms/andrew-demchenk0_afraid-cougar-9.html` | 5321 | `791fda9edbce04a8` |

All five are CSS-only: no `<script>`, no `@import`, no remote font / CDN / `url(http...)`. They render offline exactly as published, so nothing had to be silently stripped. Each keeps its in-file notice `/* From Uiverse.io by andrew-demchenk0 - Tags: ... */`.

## Candidate actually compared, and rejected

Per the max-two-candidate rule I compared **adamgiebl** (suggested soft-neumorphic basis) with **andrew-demchenk0** by reading retained raw files, not descriptions:

- adamgiebl: 41 components in the pinned revision; only **3** carry the light-neumorphic signature (#e0e0e0 surface: `Buttons/good-mouse-67`, `Buttons/lucky-donkey-6`, `Cards/strong-zebra-87`). His `Inputs` (`hot-cat-14`, `ordinary-impala-4`), `Toggle-switches/grumpy-moth-36` and `Checkboxes` use a **different** idiom (#ccc borders, Material #2196f3, no neumorphic surface); his other buttons span #2a2a2a / #2ecc71 / #2751cd / #FBCA1F / gradients. No same-author neumorphic button+input+switch+choice+card set exists — adopting it would mean inventing the missing controls, which the source gate forbids.
- andrew-demchenk0: a real author-wide cluster sharing the identical token block across button/input/switch/radio/checkbox/card/form, verified by reading the five files above. His non-adopted items (`Cards/chatty-hound-50` with 9.6 KB inline placeholder art, the heart/star SVG checkboxes) are **excluded** because they do not share the grammar.

Honesty note required by the gate: this is **not** an official complete design system. It is five real published components by one author sharing one vocabulary; the panel and choice roles are documented extensions of that basis, not new original styles.

## Three categories — keep them separate in all later work

1. **Core adopted source components** — `afraid-squid-51` (button), `polite-stingray-67` (input), `empty-penguin-100` (switch). Upstream originals, retained byte-exact; their grammar is the foundation.
2. **Additionally adopted source components** — `stupid-seahorse-9` (choice / segmented radio group), `afraid-cougar-9` (panel + square toggle + button + input composite). Still this author's published originals under the same MIT licence, adopted to cover the remaining roles. They are *source*, not our invention, and carry the same attribution duty.
3. **Genuine local extensions** — what Uiverse does not provide and we must build in the adopted grammar: per-state feedback (loading / error / disabled truth on the same 2px + hard-shadow rules), the menu / option list, and the Start-page and settings-frame app-shell layout. These are ours, must be labelled as ours, and must not introduce a second visual style.

Nothing in category 3 may be described as sourced; nothing in categories 1–2 may be described as our design.

## Adaptation map (every planned change recorded)

| Source as published | Our adaptation | Character preserved |
| --- | --- | --- |
| `afraid-squid-51` — 120x40 button, English label | label to Chinese from the setting's own copy; `class="button"` to namespaced `.uiv-button`; add disabled / aria-busy states on the same 2px + hard-shadow rules; fixed width to `min-width` so CJK labels fit; keep 40px height, 5px radius, `4px 4px` shadow, press-translate | shadow-collapse press feedback is the component's identity — kept verbatim |
| `polite-stingray-67` — 200x40 password input | `type` switchable text/password with a reveal action bound to our existing credential state; `aria-describedby` for validation text; placeholder to Chinese; fixed 200px to fluid with `max-width`; keep #2d8cf0 focus | 2px ink border, hard shadow, 5px radius, weight-600 text |
| `empty-penguin-100` — 70x36 pill switch with `content: "off"/"on"` | expose as a real switch: `role="switch"` + `aria-checked` bound to the existing boolean model; the on/off pseudo-element text becomes a Chinese token (pseudo-text is not exposed to AT); keep pill, 2px border, hard shadow, #2d8cf0 on-state, 0.3s slide; drop upstream `transform: translateX(calc(50% - 10px))` layout hack inside our flow | on/off knob slide + hard offset shadow |
| `stupid-seahorse-9`  — radio group in a 34px pill, fixed 80.5px options | `fieldset`/`legend` + Chinese labels; options come from our mode enum; fixed per-option width to flexible; keep checked = #323232 fill with #fff ink | segmented pill, same outline + hard shadow |
| `afraid-cougar-9`  — flip-card login form | adopt only the **panel rules** (`border-radius: 5px; border: 2px solid var(--main-color); box-shadow: 4px 4px var(--main-color)`) as the shared settings-frame card; drop the 3D login/signup flip, the `card-side` `content:` labels and the upstream `--bg-colorcolor` typo (undeclared variable — an upstream bug, not carried over) | panel outline / shadow / ink tokens |

Out of scope for this research task and untouched: model/Key drafts, configuration/credentials/history/Core/capture/theme owners, trusted URL, existing user data and custom palette values. Icon-morphing resources come from the parent's Morphicons pack (17 sources, Tabler, MIT) and are not duplicated here.

## Frozen state — what implementation may read

The pack is **frozen** at the table above; re-fetching revision `adbd2add...` must reproduce these SHA-256 values. Implementation may copy from `upstream/raw/**` and must keep the `From Uiverse.io by andrew-demchenk0` comment plus a pointer to `upstream/galaxy/LICENSE.md` in every adapted file.

**Open item (does not block the build):** `https://uiverse.io/` returns HTTP 403 (Cloudflare) to non-browser HTTP clients, so live permalink captures are taken with a browser session in its own session name and recorded under `upstream/page-captures/`. The raw source is already verified against the pinned upstream revision, whose README states every file is sourced from uiverse.io.
