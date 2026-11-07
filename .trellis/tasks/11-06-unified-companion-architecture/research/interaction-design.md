# Interaction and product design research: one companion across surfaces

Status: **research and discussion only.** No product code changed, no service started, no UI rendered or
captured, no microphone/speaker/camera exercised. Current-behaviour statements are read from source at
baseline `500aeba` (working tree also carries this task's doc edits). Upstream statements are read from
published source/docs at the cited URLs. **No latency number here is a measurement**; numbers are design
targets or upstream claims, labelled as such.

Scope split: GPT owns runtime/architecture. This document owns interaction, surface and product questions.
**Entry topology and performance remain proposals, not selections.**

---

## 1. Conclusions

1. **The pet is both an interaction entry and a presence surface; the console is a management surface.**
   Both are projections of one profile and one history, which the code already does
   ([`App.tsx`](../../../../apps/desktop/src/renderer/pet/App.tsx),
   [`conversation.tsx`](../../../../apps/desktop/src/renderer/console/pages/conversation.tsx)). That
   invariant is the cheapest and most valuable property to preserve in any topology. A product may
   legitimately ship a DSH page first and add the native pet later; nothing here requires the native
   window to be the first surface.

2. **"Listening / thinking / speaking must not be mutually exclusive" cannot be fixed by extending one
   enum.** The current single enum (`PET_STATES` in
   [`pet-prototype.ts`](../../../../packages/contracts/src/pet-prototype.ts#L12), phase table in
   [`demo-status.ts`](../../../../apps/desktop/src/renderer/pet/demo-status.ts#L19-L31)) encodes a
   *pipeline position*, and a pipeline is inherently exclusive. The replacement is **independent
   channels plus per-scope output ownership**, not one global owner:
   - **listening** is a property of an input scope, independent of anything being spoken;
   - **each output scope** (one surface, one conversation) has exactly **one generation owner and one
     playback owner**, so two scopes cannot interleave audio into gibberish;
   - **backchannel** is its own non-content channel and may overlap content speech;
   - **attention/notice routing** (which scope a message goes to) is a *policy*, not a global lock, and
     need not block other conversations.
   This permits genuine simultaneous speech and backchannel; it forbids only two conflicting outputs in
   the same scope.

3. **We have no streaming speech, no lip sync, no native duplex, and the UI must not imply them.**
   Playback buffers the whole utterance before it starts
   ([`playback.ts`](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L93-L103)); the mouth
   is a fixed 520 ms CSS loop with no audio input
   ([`pet.css`](../../../../apps/desktop/src/renderer/pet/pet.css#L293-L295)); the built-in provider is
   explicitly babble ([`tones.ts`](../../../../plugins/builtin-speech/src/tones.ts#L3-L4)).

4. **Speaking is invisible in the pet's own state today — a wiring defect, not a model problem.**
   `DemoController` sets phase `idle` *before* handing the finished text to the speech controller
   ([`demo-controller.ts`](../../../../apps/desktop/src/main/demo-controller.ts#L891-L899)), and the pet
   renderer never reads the speech-output snapshot. During playback the avatar is idle, the mouth still,
   and the stop entry hidden (its visibility derives from the demo phase).

5. **Barge-in is half-built.** Starting a recording cancels the in-flight turn
   ([`demo-controller.ts`](../../../../apps/desktop/src/main/demo-controller.ts#L477-L479)), but nothing
   stops queued or playing speech: `speech.stop()` runs only on a settings change and on stop-all
   ([`index.ts`](../../../../apps/desktop/src/main/index.ts#L269),
   [`index.ts`](../../../../apps/desktop/src/main/index.ts#L505)), and the tray's "stop current action"
   does not stop playback ([`index.ts`](../../../../apps/desktop/src/main/index.ts#L572-L581)).

6. **Cross-surface identity needs a scene/audience dimension that does not exist.** The agent exposes one
   session and `via: voice|bubble|console` only
   ([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L248-L257),
   [`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L541-L544)); no event or history entry
   carries a channel or audience. Cortico upstream already models one World per environment with its own
   environment prompt and tools and ships QQ/Bilibili worlds (Cortico `docs/worlds.md`) — reuse that
   shape rather than a second chat database.

7. **"Stale task steals the current turn" is an event-ingress problem.** Cortico defines `preempt`
   (discard the not-yet-externalised call, re-request with the new event) and `interrupt` (stop the turn,
   keep already-spoken output, signal interruptible tools). Our adapter only pushes `flush`
   ([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L534-L546)). A UI priority rule would
   paper over this.

8. **Persona stability comes from layered lifetimes, not from re-assembling a personality per turn.** The
   adapter already rebuilds three fixed segments from the saved profile
   ([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L90-L111)) — the right instinct. The
   failure mode is appending per-surface, per-mood, per-turn text into that prefix, which makes "same
   character everywhere" a string coincidence.

9. **Immediate expressive feedback and genuine understanding are different products.** A reflex (level
   meter, halo, breath, mouth while audio plays) is derived locally in one frame. A *deliberate* reaction
   goes through the model, arrives late and can be wrong. Show reflexes freely; never present a reflex as
   comprehension.

10. **Routing must be invisible on the reflex path and truthful on the content path.** No gateway hop in
    front of a reflex, and no mandatory per-turn classifier before the first content token. Magpie's
    intent routing is documented as a small model reading each new turn first (Magpie
    `docs/reference.md`) — exactly the hop to keep off the critical path.

11. **Generated media is a task, not a reply.** Video generation is an asynchronous job whose result can
    arrive minutes later, may not be cancellable upstream, and may still be billed. Magpie exposes video
    as normalised job routes (`POST /v1/videos`, status, content) but has **no normalised cancel**, so the
    product must own the cancellation story and state it honestly. It needs a task tray and must never
    take over an output scope or auto-post to a public surface.

12. **Which surface owns the runtime is a product decision with onboarding consequences — not a technical
    verdict.** The three combinations differ in what the user installs, who owns config, what hide/quit
    mean, and what happens with no account. §3 lays this out condition-neutrally and does not pick.

---

## 2. Evidence status

| Claim type | Status |
| --- | --- |
| Current pet/console/agent behaviour | Read from source, line-anchored. Not re-run. |
| Current visual/motion behaviour | Read from CSS/component source. **Not rendered, not screenshotted, not observed on a device.** |
| Audio capture/playback | Read from source. **Not recorded, not played, not measured.** |
| Coopanion / Cortico | Published README/docs plus a few source files at `main`. Not installed, not run. |
| Higgs Realtime Duplex | Boson AI blog, 2026-11-05. Product claims; duplex API announced *coming soon* with a waitlist. |
| Magpie | README, `docs/reference.md`, and the pinned source review in [magpie-routing.md](magpie-routing.md). Not installed, not called. |
| DSH surfaces | Installed CLI `0.2.2-rc.1` README and bundled package READMEs. The Desktop carrier is not in this npm installation, so its behaviour is documented-but-unverified here. |

Two distinctions kept strictly apart, because conflating them turns "realtime" claims false:

- **System-level duplex** — the app can listen while it plays, can be interrupted, and can run background
  work during a conversation. Achievable with streaming ASR, a cancellable turn and a stoppable player.
  This is what the project can honestly build.
- **Model-level duplex** — one model consumes and emits 160 ms audio/video chunks, decides when to speak
  and backchannels, in one forward pass (Higgs Realtime Duplex). **This product has no such integration
  today, and the new Higgs duplex API is not open yet (announced "coming soon", waitlist).** Higgs
  Realtime, the product available today, is a different, avatar-output API. This is a statement about
  *our* integration and *that one* vendor's release state, not a claim that native duplex is unavailable
  everywhere — other vendors and future releases are unexamined here.

---

## 3. Entry topology, condition-neutral

### 3.1 Surfaces

- **Pet window** — presence plus a fast interaction entry: always-on-top, transparent, click-through
  except on painted shapes, never steals focus
  ([`pet-window.ts`](../../../../apps/desktop/src/main/windows/pet-window.ts#L140-L175)).
- **Console** — authority and configuration: plugin-contributed pages plus quiet recovery entries
  ([`app-views.ts`](../../../../apps/desktop/src/renderer/console/app-views.ts#L41-L57)), one shared
  profile with revision-checked saves.
- **Agent host** — owns the turn, event store, memory and tools. Today Cortico Core inside a normal plugin
  ([ADR-0014](../../../../docs/adr/0014-cortico-agent-runtime.md)).

The topology question is not "where does the pet live" but **who owns runtime, config authority and
lifecycle** — and consequently what the user installs and what "close" means.

### 3.2 Three combinations

| | **A. DSH runtime + thin Electron pet** | **B. Standalone runtime + DSH entry/pet** | **C. Current Electron full host** |
| --- | --- | --- | --- |
| Install | DSH plus a thin pet client | one pet app; DSH optional | one pet app |
| First run | needs **designed onboarding**: a DSH-side guide, model connection and an offline/scripted path are all implementable — plugins can supply a local guide and offline fixtures. Work to design, not a blocker | pet's own bubble guide, as today | pet's own bubble guide, as today |
| Config authority | DSH settings document plus our preferences, either re-declared as DSH settings entries or proxied to our store; a real integration task with a real cost, not an impossibility | our `ConfigService` CAS stays authoritative; DSH is one more client | our `ConfigService` CAS |
| Plugin model | DSH Loader/bundles with `engines.dsh` ranges and exemptions, alongside or replacing our manifest/owner-generation model | our single plugin model; DSH as adapter | our single plugin model |
| Thin-client connection | `dsh --profile sdk` (JSON-RPC stdio) and `dsh --profile acp` (ACP stdio) are documented ways to drive a session from an external client, and an app-owned profile can be loaded directly by an embedding host. **Caveat: these prove text/control connectivity only; a native media bridge (capture, playback, barge-in signalling) from a thin Electron client into a DSH-hosted session is still unverified.** | n/a | n/a |
| Hide | pet window hides; the DSH host keeps running — two lifecycles to explain | pet hides; runtime keeps running in the app | pet hides; console hides rather than closes ([`console-window.ts`](../../../../apps/desktop/src/main/windows/console-window.ts#L60-L62)) |
| Quit | one quit path per product; client quit ≠ host quit | one quit path | one quit path; `window-all-closed` quits ([`index.ts`](../../../../apps/desktop/src/main/index.ts#L627)) |
| Offline | needs an explicit offline story, which plugins can provide; must not silently claim a model answered | scripted reply retained and labelled ([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L278-L293)) | same as B |
| Microphone | DSH voice input is page-side recording into a draft (`dsh-experimental-client-ui-voice-input`); a native pet needs a host-owned capture owner, so this must be added | one capture owner, as today | one capture owner — but bound to the settings window ([`index.ts`](../../../../apps/desktop/src/main/index.ts#L595-L602)) |
| Speech output | this DSH installation ships speech-to-text only (no TTS package); any option needs an output provider | ours | ours |
| Native pet window | still Electron, still preload, still separate from the DSH Web page (browser page, tokenised URL, port 3080 default, `dsh-web-app` README) — additional work to scope | native | native |
| Upgrade | DSH version + plugin compatibility ranges, two release trains | one train | one train |

Facts that are **not** verdicts: `dsh` reserves the profile name `desktop` for its Electron carrier and
rejects CLI boot/config-dump for it (DSH CLI README); a thin client simply uses an ordinary custom profile
name, and nothing follows about feasibility. That the DSH Web GUI is a browser page is a fact about that
surface, not a claim that a native pet is unwelcome in DSH.

### 3.3 Reading, without choosing

- **C** is the only option where "double-click and it is there, offline, no account" is already true, and
  where pet preferences and console pages are the same document by construction. Cost: the whole plugin
  kernel, permissions, agent and model connections are ours to maintain.
- **A** inherits a mature agent/plugin substrate and a strong settings-form system. Cost: onboarding,
  config authority and capture ownership must be designed across two products, and the pet becomes an
  additional native surface the DSH Web GUI does not have.
- **B** keeps our runtime self-sufficient and lets DSH be an entry/integration rather than a prerequisite.
  Cost: the least "free" — we keep maintaining the runtime — and a DSH-first user gets no integrated
  product on day one.

A constraint holding in every option: **the pet must not depend on a second window being alive in order
to hear the user.** Today it indirectly does — the recording owner is the settings window's
`webContents`, and a renderer crash drops it to `null`
([`index.ts`](../../../../apps/desktop/src/main/index.ts#L595-L602)). Any topology should move capture
ownership to the runtime.

---

## 4. One character, several social situations

### 4.1 Layers

Identical across surfaces: identity (name, self-concept, relationship), the memory visible to that
surface, the voice/face/action vocabulary, and honesty rules ("only report what succeeded"). Different:
register, what it may initiate, how much it reveals, how it addresses a crowd versus one person.

| Layer | Changes with | Lives where |
| --- | --- | --- |
| Identity | almost never; versioned | persona prefix, shared |
| Relationship | slowly | memory, per user |
| Scene policy | per surface | channel config, **not** the persona |
| Register | per turn | derived from scene + affect |
| Transient affect | seconds–minutes, decays | runtime state, carried as bounded dynamic context |

Putting scene policy into persona text is the "re-assemble the personality per surface" failure: the same
character becomes a prompt rewritten per surface, and identity drifts silently.

### 4.2 Privacy: a necessary protection layer, not a guarantee

Scoping is the only mechanism that can *prevent* a class of leakage; a prompt instruction only hopes. But
scoping **cannot guarantee** that nothing private ever reaches a public surface — models paraphrase,
retrieved items can be summarised, and a user can ask for something private in public. It reduces risk and
makes violations detectable; it does not eliminate them.

Candidate policies, **none selected**:

- **Scope tags on memory items**: `private`, `household` (the user's own surfaces), `public`. Whether
  `private` means *device-scoped* is a candidate choice, not a requirement. Default candidate: `private`.
- **Scope filter at context assembly**, so a public turn's context contains only allowed scopes — enforcement
  at the data path, cheaper to test than prompt wording.
- **Public-only memory for public surfaces**; private continuity preserved via identity and relationship
  rather than transcript replay.
- **No automatic publication** of artifacts or private facts to public surfaces; explicit user action
  required. Artifacts inherit the origin surface's scope.

None of this is expressible today: `ApplicationInteraction` has `via` and `mode` but no surface or
audience ([`application.ts`](../../../../packages/contracts/src/application.ts#L150-L167)), and the agent
event meta carries only `via`/`mode`/`kind`
([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L536-L545)).

### 4.3 Attention and switching (candidate policy)

1. **Per-scope output ownership** (conclusion 2): one generation/playback owner per scope, so scopes
   cannot corrupt each other's audio.
2. **Notice routing is a policy**: a task completion or ambient question goes to its origin scope, or is
   queued for a stated foreground scope — not by preempting everything.
3. **Ambient surfaces may be served concurrently** when their scope is free; they need not wait for the
   desktop conversation to end.
4. **Switching which surface the companion is addressing is a user act** (pet menu, console, typed
   command), and it states what happens to work in flight.
5. **Each surface shows only its own transcript**; the console may show all with scope tags.

---

## 5. Full duplex: independent channels, per-scope output ownership

### 5.1 State model

| Fact | Values | Read as |
| --- | --- | --- |
| `input[scope]` | `closed` \| `open` \| `voice-detected` \| `transcribing` | can it hear me / is it hearing me |
| `output[scope]` | `silent` \| `preparing` \| `speaking` \| `interrupted` | is sound coming / did I cut it |
| `backchannel` | `idle` \| `acknowledging` | a short acknowledgement, not content |
| `work` | count + oldest task kind | busy elsewhere |
| `affect` | small set, decaying | how it feels |

`listening` and `speaking` are no longer states; they are `input[scope]=open` and `output[scope]=speaking`,
and coexist by construction. Exclusivity lives only *within* an output scope. This is the concrete answer
to R3, and a data-model change rather than a rendering trick.

Honest consequence: when the user talks over the companion the correct presentation is one transition —
`output: speaking → interrupted`, then `input: open` — not two competing animations. Mouth stops, halo
starts.

### 5.2 Minimal presentation: one line, two marks

Constraints: window 380×420 DIP
([`pet-window.ts`](../../../../apps/desktop/src/main/windows/pet-window.ts#L68)), bubble 252 px with a
56-character cap ([`demo-status.ts`](../../../../apps/desktop/src/renderer/pet/demo-status.ts#L48)), tool
stack two 34 px circles.

- **Primary line** (existing bubble slot): the current scope's content — partial transcript while the user
  speaks, companion text while it speaks, otherwise one short phrase for the current work item.
- **Mark 1 — input**: the existing listening halo and ear perk
  ([`pet.css`](../../../../apps/desktop/src/renderer/pet/pet.css#L241-L263)), allowed to stay on while the
  companion speaks. That coexistence is the visible duplex claim.
- **Mark 2 — work**: one small badge with a count, in the thinking-dots slot
  ([`pet.css`](../../../../apps/desktop/src/renderer/pet/pet.css#L265-L287)). Not a per-task list.
- Nothing else: no separate thinking/speaking spinners, no progress bars, no per-surface lamps. `affect` is
  carried by the avatar, not by text.

Precedent: Coopanion converges on the same minimalism — one status bubble with kind, short text, one
detail and an optional count, aggregating consecutive calls of one kind
([`src/status.ts`](https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/src/status.ts)).
Its `RunPhase` (`idle/delivering/model/tools/backoff/handoff`) collapses to *one* visible "thinking".

### 5.3 Backchannel versus content

- **Backchannel** ("mm-hm", a nod, a short rising tone): cheap, non-blocking, not transcribed as an
  utterance, not routed through the speech provider's 4-slot queue
  ([`speech-output-controller.ts`](../../../../apps/desktop/src/main/speech-output-controller.ts#L240-L241)),
  gated on real evidence (voice activity or a partial transcript), never on a timer.
- **Content speech** owns the scope's output, goes through the provider, is cancellable, is recorded.

Today everything is content speech; there is no backchannel channel. The cheapest honest version is a
local, non-LLM acknowledgement during `voice-detected`: no model call, no added latency, and no claim of
comprehension.

### 5.4 Barge-in: one verb, four effects

1. **Audio stops now** — `SpeechPlaybackOwner.stop()` exists
   ([`playback.ts`](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L160-L176)) but is not
   wired to recording start.
2. **Queued utterances drop** — `stopNow()` clears the queue and bumps the epoch
   ([`speech-output-controller.ts`](../../../../apps/desktop/src/main/speech-output-controller.ts#L576-L588)).
3. **The in-flight turn is cancelled at the model boundary**, keeping what was already spoken as having
   happened ([`demo-controller.ts`](../../../../apps/desktop/src/main/demo-controller.ts#L477-L479)) — but
   the speech task belongs to a different controller, so 1 and 3 are not atomic today.
4. **The record says so** — cancelled/partial, not silently vanished; the speech side keeps
   `lastUtterance` text deliberately
   ([`speech-output.ts`](../../../../packages/contracts/src/speech-output.ts#L93-L94)).

"Stop" should be one button with these four effects. Today it is buried in the menu's "more" section
([`PetMenu.tsx`](../../../../apps/desktop/src/renderer/pet/PetMenu.tsx#L374-L385)) and only offered when
the demo phase is stoppable — which excludes playback, because the phase is already `idle`.

### 5.5 Failure and recovery

Existing vocabulary is good and should be preserved: every message names which call failed
([`copy.ts`](../../../../apps/desktop/src/renderer/pet/copy.ts#L52-L61)), and the speech provider refuses
rather than silently substituting a provider
([`speech-output-controller.ts`](../../../../apps/desktop/src/main/speech-output-controller.ts#L226-L239)).

| Situation | Must show | Must not happen |
| --- | --- | --- |
| Mic unavailable | one explicit line; input mark visibly off | pretending to listen |
| Model/tool failure mid-turn | the failed step, with what already happened kept | silently restarting and re-speaking old text |
| TTS failure after text | text stays, one "voice unavailable" mark, retry | silent fallback to another voice |
| Interrupted by user | a normal, recorded event | presenting it as an error |
| Recovered | one "resumed" transition | replaying the cancelled utterance |

Precedent: Coopanion reports after five consecutive model failures with the upstream reason and a button
to the relevant settings page (Coopanion README, FAQ). Good bar: reported once, with a cause and an exit.

---

## 6. Persona that holds still, emotion that moves, voice that matches

### 6.1 Four lifetimes

Identity contract (months, versioned prefix) → scene policy (per surface, its **own** segment) → memory
(weeks, scoped) → affect (seconds–minutes, **kept out of the stable prefix**).

The last rule is about *where* affect lives, not a prohibition. The constraint is: **do not rewrite the
stable persona prefix per mood.** A transient mood may legitimately reach the interacting model as a
*controlled dynamic context* — a separate, bounded, decaying field carried with the turn (for example
alongside the scene segment or as a per-turn context block) — so the same character can look and sound
flustered without identity becoming a function of sampling or of the current second. Rejected: mutating
the versioned prefix, or letting affect accumulate unboundedly in it. Accepted: a small, inspectable
dynamic contribution whose lifetime ends with the mood.

The adapter is close already: `segments()` produces `persona.identity`, `persona.body`, `world.desktop`
from the saved profile and reloads via `core.loop.reloadSystemPrefix()`
([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L90-L111),
[`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L128-L142)). Needed: an additive
`scene.<surface>` segment and scoped memory retrieval — not a longer persona.

### 6.2 Voice, face, action: one mapping, three renderers

```
event (level, partial text, tool kind, task state, poke, time)
  → affect (small set, decay, hysteresis)
  → intent (listening / acknowledging / explaining / working / idle)
  → presentation (prosody, face, gesture) from a table
```

- **Hysteresis and decay.** An affect set by a poke lasts a fixed time and decays; it is not re-rolled per
  frame. `ExpressionTimeline` is exactly this pattern for one emotion (blush, 1200 ms, one receipt after a
  visible frame — [`expression.ts`](../../../../apps/desktop/src/renderer/pet/expression.ts#L16-L67)).
  Generalise that class; do not add a second animation system.
- **Truthful vocabulary.** The contract declares five interaction kinds including `happy`
  ([`application.ts`](../../../../packages/contracts/src/application.ts#L239)) and the agent labels them
  ([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L419-L425)), but **no renderer produces or
  draws `happy`** — a word with no face. Draw it or remove it; dead vocabulary is how "expressive" becomes
  a claim.

Not to build: model-chosen arbitrary animations per turn (slow, unbounded, body as a function of sampling
temperature); a `mood` field in the profile; renderer-side sentiment inference (no context, so it produces
exactly the random reactions the user rejected); any lip-sync claim (no `AnalyserNode` anywhere in the
renderer — the mouth is a 520 ms CSS loop; drive it from playback amplitude or keep it stylised and never
call it lip sync).

---

## 7. Sound: three different things

| Kind | Exists here | Evidence | Honest label |
| --- | --- | --- | --- |
| Babble / 拟声 | per-grapheme sine bursts, 70 ms, max 24 glyphs, pitch from code point | [`tones.ts`](../../../../plugins/builtin-speech/src/tones.ts#L3-L21) | "makes sounds while text appears"; not reading aloud |
| TTS | Windows SAPI via a fixed PowerShell helper; whole-utterance PCM at 24 kHz | [`system-tts/src/index.ts`](../../../../plugins/system-tts/src/index.ts#L1-L40) | "reads text aloud", Windows only, non-streaming |
| Streaming TTS | none; playback waits for the full utterance | [`playback.ts`](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L93-L103) | absent |
| Native duplex AV model | not implemented in this product | Higgs blog (new duplex API "coming soon", waitlist; existing Higgs Realtime API is available and is a different, avatar-output product) | not integrated here; not a claim about other vendors |

Consequence: **text can stream while audio cannot**, so any UI revealing text at speaking pace drifts ahead
of the voice. The bubble already has a per-grapheme reveal clock with punctuation pauses
([`bubble-reveal.ts`](../../../../apps/desktop/src/renderer/pet/bubble-reveal.ts#L46-L57)) — a *text* clock,
unrelated to the voice. Coopanion runs two clocks and drops syllables when the voice falls ~1 s behind
([`web/speech.js`](https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/web/speech.js)).
If we want "talks while text appears", reconcile the two clocks; if not, stop pretending and reveal the
line.

Also: capture requests **no** echo cancellation, noise suppression or gain control
([`microphone.ts`](../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L207-L212) — only
`channelCount`). That does **not** prove the assistant will hear itself: browsers may already apply echo
cancellation by default (Chrome does for `getUserMedia` audio unless disabled), and the platform pipeline
may handle it. The honest statement is that echo suppression during simultaneous playback and capture is
**unverified here** and needs a real-device duplex test, including a loud loopback case. Coopanion
explicitly requests echo cancellation and noise suppression (Coopanion README) — one plausible
configuration, not a guarantee. This is an acceptance measurement, not a settled fix.

---

## 8. R8: models, routing, generated media

### 8.1 Immediate feedback is not understanding

- A **reflex** must be local: audio level, VAD, playback amplitude, tool-call kind, task count, poke. One
  frame, no cost.
- A **deliberate reaction** goes through the agent: model call → tool → renderer confirmation. Hundreds of
  milliseconds at best; a tool-using turn adds a full round trip.

Rule: **the body reacts on the reflex path; the mind may request a reaction, and the request is an
intention until the renderer confirms it.** The confirmation half already exists — a reaction is recorded
only after it was drawn and visible
([`expression.ts`](../../../../apps/desktop/src/renderer/pet/expression.ts#L55-L67)), and gestures are
recorded only from physically verified actions
([`pet-gesture.ts`](../../../../apps/desktop/src/renderer/pet/pet-gesture.ts#L35-L44)). Keep that and add
reflexes on the other side of the ledger, clearly not recorded as comprehension.

Anti-pattern: a periodic "I'm listening" nod with no input — attentive for ten seconds, then a puppet. An
acknowledgement may only be tied to real voice activity or a partial transcript.

### 8.2 Routing invisible, capability and failure loud

Routing becomes product-visible in exactly four cases, each with a fixed small presentation:

1. **Capability gap** — the route cannot do what was asked (no image input, no tool calls): say it before
   the attempt when knowable, plainly when not.
2. **Failure** — with cause and exit (§5.5).
3. **Cost/quota** — only if the user opted in; never a per-turn nag.
4. **Diagnostics** — opt-in, in the console, not on the pet.

Latency constraint on architecture: **no routing hop on the reflex path, and no mandatory classifier
before the first content token.** If a classifier is used, run it concurrently with the first attempt, with
a deadline and a declared default route. Cheaper and more predictable: route by declared task class
(chat / reasoning / vision / image-gen / video-gen / classify) plus surface policy, and treat ambiguity as
"use the default". The pinned source review adds a concrete reason to keep stop/barge-in out of the
classifier path: Magpie's chat classifier builds its own timeout from a background context and shares
in-flight identical classifications, so cancelling the parent request should not be assumed to cancel
router work ([magpie-routing.md](magpie-routing.md) §"When a tiny router saves time, and when it adds
time").

Verified gateway facts (Magpie docs and pinned source review, not run):

- One local endpoint (`127.0.0.1:3425`) speaking OpenAI Chat, OpenAI Responses, Anthropic Messages and
  Gemini, translating between them including streaming, tool calls and reasoning.
- Routing groups with `smart`/`order`/`rotate`/`usage`/`pace`/`weight`/`fast`, plus `stays=` session
  affinity — keeps one conversation on one account while its prompt cache is warm (persona stability, not
  only cost).
- A dedicated **decision-model** path (`POST /v1/systemone` with `state.message` and `questions.intent`),
  distinct from chat models — the legitimate home for a router if one is used.
- **Video as a normalised asynchronous job API**: `POST /v1/videos`, `GET /v1/videos/{id}`,
  `GET /v1/videos/{id}/content`, with provider branches for an OpenAI-shaped video API, another Magpie,
  Ark/Seedance, MiniMax H3 and Grok; job ids retain provider/vendor identity and, where relevant, the
  originating key/account; polling and download are separate requests. Source-pinned, not run — see
  [magpie-routing.md](magpie-routing.md) §"What the pinned Magpie implementation actually exposes".
- **No normalised cancel/delete** was found (`DELETE /v1/videos/{id}` is not registered). A
  vendor-specific cancel/delete is reachable only through the native passthrough
  (`/v1/magpie/native/<provider>/<path>`, which allows Ark task GET/DELETE and general DELETE), and
  whether that cancels a pending job, deletes a finished asset, or both is provider-specific and must be
  verified per provider. Closing the create/poll connection does not cancel an accepted remote job. The
  image MCP job deliberately detaches from the tool call and keeps jobs in memory, so ending a tool call
  does not cancel generation either. See [magpie-routing.md](magpie-routing.md) §"Cancellation, jobs and
  generated artifacts".

### 8.3 Generated media: a task tray, not a chat message

A video job can outlive the conversation, so the UX must always answer: *what was asked, where will it
appear, can I stop it, what did it cost.*

- **Submission** is a normal turn on the asking surface. The reply is one sentence: what will be made and
  where it will arrive.
- **While running**, the pet shows only the work badge count (a video job has no meaningful percentage);
  the console shows a task row with origin surface, kind, submitted time, state
  (`submitted`/`accepted`/`running`/`completed`/`failed`, plus `cancel-requested`/`cancel-confirmed`/
  `acceptance-unknown`) and a cancel control.
- **Cancel** must be honest about the actual lifetimes: cancelled before submission; cancellation
  requested and confirmed; requested but not confirmed; already accepted, so it may still be produced and
  billed. The gateway gives no portable cancel contract, so the UI states which case it is rather than
  promising one outcome.
- **Delivery** goes to the originating surface by default; a different surface needs an explicit
  instruction, and a **public** surface needs confirmation, because visibility changes with destination.
- **The result never takes over an output scope**: it arrives as a notice that waits for the current turn
  to end, or is appended to its origin thread if that surface is not foreground.
- **Do not silently move an accepted job to another provider or account** — that creates a second job. A
  create request whose acceptance is unknown is not automatically safe to retry.

---

## 9. Stress scenario: QQ video task, desktop voice, Bilibili question

| # | Event | Observable behaviour | Must hold |
| --- | --- | --- | --- |
| 1 | Video requested in a QQ thread | desktop bubble: one line "视频任务已提交", work badge `1` | artifact scope `private`; desktop bubble does not print the QQ text |
| 2 | User starts desktop voice | halo on, partial transcript in the primary line | the QQ task is a background fact, not the primary line; only the badge count shows it |
| 3 | Companion answers; audio plays | mouth moves with audio; halo may stay on | `output[s]=speaking` and `input[s]=open` coexist — the visible duplex claim |
| 4 | User cuts in | audio stops, mouth stops, halo on, new partial replaces the old line | one transition; the interrupted utterance stays in the record marked interrupted, not failed |
| 5 | Public viewer asks on Bilibili | a "1 waiting" mark; **no public text in the pet bubble** | the public question is not answered over the user's turn; no private-scope memory in its context |
| 6 | Video task completes | badge `2 → 1 → 0`; one-line notice queued | the notice does not preempt the desktop turn and does not appear in the public channel |
| 7 | Desktop turn ends | the public answer appears in the Bilibili surface only | the public answer contains only allowed scopes; the QQ video is never mentioned |
| 8 | User asks "where's my video?" on desktop | artifact reference delivered on the desktop | delivery follows the asking surface |

### 9.1 Acceptance-verifiable minimal sequence

Scripted provider, fake audio, no paid calls; assertions on records and state, not impressions.

1. Stub QQ submission → task record `origin=qq`, `scope=private`, `state=submitted`; pet primary line
   contains no QQ message text.
2. Start desktop recording → exactly one capture owner; task not in the primary line; badge `1`.
3. Scripted reply plays → **the same snapshot** has `output=speaking` and `input=open`.
4. Barge-in → playback stopped within the configured bound; turn `interrupted`; spoken prefix retained;
   no second utterance started.
5. Inject a public question → not answered while the desktop scope is busy; the eventual public turn's
   assembled prompt contains **zero** private-scope items (assert on what the scripted provider received).
6. Task completes → notice did not preempt the desktop turn; the public channel received nothing about it.
7. Desktop turn ends → the public answer is delivered to the public surface only.
8. Ask for the artifact on the desktop → delivery follows the asking surface; one artifact identity in
   the record.

Steps 3, 5 and 6 are load-bearing for the "one companion across surfaces" claim, and each is a pure
data-model assertion — cheap to automate, expensive to fake.

---

## 10. Minimal experience acceptance on existing functions

| # | Slice | Present today | Needs | Pass condition |
| --- | --- | --- | --- | --- |
| 1 | Same identity, two surfaces, one record | one profile, one history, `via` tag ([`conversation.tsx`](../../../../apps/desktop/src/renderer/console/pages/conversation.tsx#L158-L187)) | `surface`/`audience` on interactions | bubble and typed text appear once, in one timeline, with a surface tag |
| 2 | Speaking is visible | speech snapshot with `phase: playing` ([`speech-output.ts`](../../../../packages/contracts/src/speech-output.ts#L84-L97)) | pet reads it; mouth from real amplitude | avatar not idle during playback; mouth correlates with audio |
| 3 | Barge-in | `stop()`, queue clear, turn cancel | one verb wiring all four effects (§5.4) | audio stops on talk-key/mic; turn `interrupted`; no second utterance |
| 4 | Simultaneous listen+speak | halo and playback independent | the multi-channel state model (§5.1) | one snapshot shows `input=open` and `output=speaking` |
| 5 | Backchannel honesty | VAD/level in the capture path | a local non-LLM acknowledgement channel | acknowledgement only with real input; never in the content queue |
| 6 | Background task does not take the scope | task/cancel model, `deliver:false` | work badge + notice-routing policy | a long task during a conversation changes only the badge |
| 7 | Failure is truthful | per-call error text, no silent fallback | one degraded mark + retry | killing TTS leaves text, shows one reason, no substitute voice |
| 8 | Expression is earned | `ExpressionTimeline` visible-frame receipt ([`expression.ts`](../../../../apps/desktop/src/renderer/pet/expression.ts#L28-L67)) | draw `happy` or delete it; generalise decay | no reaction recorded without a visible frame; no dead vocabulary |
| 9 | Scene scoping | — | scope on memory items; assembly filter | a public turn's prompt contains no private items |
| 10 | Offline honesty | labelled scripted reply ([`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L278-L293)) | none | with no key, nothing claims a model answered |

Slices 1–4 and 7 make the product feel alive and need no new model, gateway or platform integration —
the first acceptance set. Slices 5–6 and 9 make "one companion across surfaces" true rather than asserted.

---

## 11. Gaps found (source-anchored)

| # | Gap | Anchor | Consequence |
| --- | --- | --- | --- |
| G1 | One exclusive pipeline state per snapshot | [`demo-status.ts`](../../../../apps/desktop/src/renderer/pet/demo-status.ts#L19-L31), [`pet-prototype.ts`](../../../../packages/contracts/src/pet-prototype.ts#L12) | cannot show listening while speaking; barge-in looks like a reset |
| G2 | Playback phase never reaches the pet | [`speech-output.ts`](../../../../packages/contracts/src/speech-output.ts#L84-L97), [`App.tsx`](../../../../apps/desktop/src/renderer/pet/App.tsx#L385) | idle avatar during speech; still mouth; stop hidden |
| G3 | Playback whole-utterance, not streaming | [`playback.ts`](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L93-L103) | first sound waits for full synthesis; interruption granularity is one utterance |
| G4 | Recording start does not stop speech | [`demo-controller.ts`](../../../../apps/desktop/src/main/demo-controller.ts#L477-L479), [`index.ts`](../../../../apps/desktop/src/main/index.ts#L572-L581) | old answer talks over the new question |
| G5 | Echo cancellation / noise suppression not explicitly requested | [`microphone.ts`](../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L207-L212) | echo suppression during simultaneous play+capture unverified; needs a real-device duplex test (browser defaults may already cover it) |
| G6 | Capture owner is the settings window | [`index.ts`](../../../../apps/desktop/src/main/index.ts#L595-L602), [`console-window.ts`](../../../../apps/desktop/src/main/windows/console-window.ts#L60-L62) | a renderer crash silently disables the pet's microphone |
| G7 | No surface/audience on events or history | [`application.ts`](../../../../packages/contracts/src/application.ts#L150-L167), [`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L536-L545) | no scoping, no per-surface transcript |
| G8 | `preempt`/`interrupt` unused; only `flush` | [`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L534-L546) | stale work can win the turn |
| G9 | Single `active` turn, `not-ready` on concurrency | [`agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs#L483) | a second surface cannot be served without blocking the first |
| G10 | `happy` declared, never drawn | [`application.ts`](../../../../packages/contracts/src/application.ts#L239) vs [`expression.ts`](../../../../apps/desktop/src/renderer/pet/expression.ts#L13) | expressive vocabulary partly imaginary |
| G11 | Live partial transcript only for two local engines | [`demo-controller.ts`](../../../../apps/desktop/src/main/demo-controller.ts#L756-L760) | "listening" feedback silently absent on other engines |
| G12 | No image/video capability contract | searched `packages/contracts/src/*.ts` | generated media cannot be expressed as a task |
| G13 | Recording capped at 20 s | [`local-asr.ts`](../../../../packages/contracts/src/local-asr.ts#L71) | long duplex conversation is a series of 20 s takes |

G11 and G13 are not defects to hide; they are the current envelope and belong in any demo script.

---

## 12. Claims this round must not make

- "Real-time duplex" as a *model* property **in this product**: it is not implemented here. The new
  Higgs duplex API is not open (waitlist); Higgs Realtime, available today, is a different
  avatar-output API. This says nothing about other vendors or future releases.
- Any latency figure. Nothing was measured. Upstream's "~200 ms", "160 ms chunks" and "2.6–5K tokens per
  minute" are **their** targets and claims.
- Lip sync, streaming speech, or "same character everywhere" (one surface and one scene today).
- "Routing is transparent": intent only; nothing is wired and Magpie was read, not run.
- "Echo cancellation will fix duplex": unverified; needs a device test.
- Any DSH Desktop behaviour: the Desktop carrier is not in this installation.

Worth stating because it shapes how much to borrow: on Boson's own table the duplex model is **not**
uniformly ahead — behind the TML interaction model on Full-Duplex-Bench v1.5 (75.5 vs 77.8) and
ProactiveVideoQA (31.9 vs 33.5), and behind GPT-Live on both. Its differentiator is being one model that
thinks, calls tools and delegates while listening and speaking. That is an architecture lesson (front
model keeps the conversation; background work creates no dead air), adoptable without the model.

---

## 13. Decisions the user must make

Every policy in this document (scopes, floor/output ownership, notice routing, backchannel gating,
routing placement, cancel semantics) is a **candidate**, not an accepted requirement. The decision entry
point is the task's `prd.md` and the main design document; this file supplies evidence and options for
that discussion.

1. **Entry topology (A / B / C).** Recommendation: **B** — offline self-sufficiency and single capture
   ownership already work and are cheapest to keep, while DSH can still be an entry. Trade-off: B keeps
   our whole runtime to maintain and gives a DSH-first user no integrated product on day one. A inherits a
   mature agent/plugin substrate at the cost of designing onboarding, config authority and capture across
   two products. C is today's behaviour with no new integration value.
2. **First acceptance slice: "alive" or "everywhere"?** Recommendation: "alive" — §10 slices 1–4 and 7.
   Trade-off: it does not demonstrate cross-platform identity, the flashier claim.
3. **Memory visibility.** Recommendation: scopes enforced at context assembly, default private. Trade-off:
   requires migrating existing history and a re-scoping UI, and makes cross-surface continuity feel
   forgetful by design. This is protection, not a no-leak guarantee.
4. **Attention policy when surfaces collide.** Recommendation: per-scope output ownership, ambient
   surfaces served concurrently, notice routing by policy. Trade-off: more moving parts than one global
   lock, and users may still expect one obvious "who is it talking to".
5. **May a router sit in front of the content turn?** Recommendation: no mandatory classifier; route by
   declared task class and surface policy. Trade-off: less adaptive, more predictable latency and cost.
6. **What "stop" means for a generated media job.** Recommendation: the honest outcomes in §8.3.
   Trade-off: some users will expect a hard cancel.

---

## 14. Sources

### In-repo

- [`apps/desktop/src/renderer/pet/App.tsx`](../../../../apps/desktop/src/renderer/pet/App.tsx) — surface
  composition, hit regions, expression trigger, single-notice precedence.
- [`apps/desktop/src/renderer/pet/demo-status.ts`](../../../../apps/desktop/src/renderer/pet/demo-status.ts)
  — phase→state table, transcript handling, bubble cap.
- [`apps/desktop/src/renderer/pet/expression.ts`](../../../../apps/desktop/src/renderer/pet/expression.ts)
  — visible-frame receipt, decay, generation guarding.
- [`apps/desktop/src/renderer/pet/pet.css`](../../../../apps/desktop/src/renderer/pet/pet.css) — state
  animations, mouth loop, reduced-motion and forced-colors handling.
- [`bubble-reveal.ts`](../../../../apps/desktop/src/renderer/pet/bubble-reveal.ts),
  [`pet-gesture.ts`](../../../../apps/desktop/src/renderer/pet/pet-gesture.ts),
  [`PetMenu.tsx`](../../../../apps/desktop/src/renderer/pet/PetMenu.tsx).
- [`apps/desktop/src/renderer/speech-output/playback.ts`](../../../../apps/desktop/src/renderer/speech-output/playback.ts)
  — sole audio consumer, whole-utterance playback.
- [`apps/desktop/src/main/demo-controller.ts`](../../../../apps/desktop/src/main/demo-controller.ts) —
  single intent, phase machine, live-transcription gating, reply→speech handoff.
- [`apps/desktop/src/main/speech-output-controller.ts`](../../../../apps/desktop/src/main/speech-output-controller.ts)
  — queue, epochs, provider selection, playback receipts.
- [`apps/desktop/src/main/index.ts`](../../../../apps/desktop/src/main/index.ts) — lifecycle, tray, capture
  owner binding, where `speech.stop()` is and is not called.
- [`apps/desktop/src/renderer/console/demo/microphone.ts`](../../../../apps/desktop/src/renderer/console/demo/microphone.ts)
  — capture constraints and failure vocabulary.
- [`plugins/agent-cortico/src/agent.mjs`](../../../../plugins/agent-cortico/src/agent.mjs) — persona
  segments, single active turn, event triggers, interaction kinds.
- [`plugins/builtin-speech/src/tones.ts`](../../../../plugins/builtin-speech/src/tones.ts),
  [`plugins/system-tts/src/index.ts`](../../../../plugins/system-tts/src/index.ts) — babble vs TTS.
- [`packages/contracts/src/pet-prototype.ts`](../../../../packages/contracts/src/pet-prototype.ts),
  [`demo.ts`](../../../../packages/contracts/src/demo.ts),
  [`application.ts`](../../../../packages/contracts/src/application.ts),
  [`speech-output.ts`](../../../../packages/contracts/src/speech-output.ts),
  [`local-asr.ts`](../../../../packages/contracts/src/local-asr.ts) — constraining contracts.
- [`docs/adr/0002-standalone-with-optional-dsh.md`](../../../../docs/adr/0002-standalone-with-optional-dsh.md)
  (annotated as reopenable), [`docs/adr/0014-cortico-agent-runtime.md`](../../../../docs/adr/0014-cortico-agent-runtime.md),
  [`docs/plugin-pet-mvp.md`](../../../../docs/plugin-pet-mvp.md),
  [`docs/pet-bubble-design.md`](../../../../docs/pet-bubble-design.md),
  [`docs/live-transcript-menu.md`](../../../../docs/live-transcript-menu.md),
  [`docs/02-coopanion-ui-review.md`](../../../../docs/02-coopanion-ui-review.md).

### DSH (installed CLI `0.2.2-rc.1` in this environment)

- `…/@deepseek-ai/dsh/README.md` — entry modes (`web`/`headless`/`sdk`/`sdk-minimal`/`acp`), profiles,
  the reserved `desktop` profile name, the `profile-boot` export used by the Desktop carrier.
- `…/dsh-web-app/README.md` — `dsh --profile web`, tokenised URL, port 3080 default.
- `…/dsh-client-ui-settings/README.md`, `…/dsh-client-ui-settings-plugins/README.md` — `settings.section`
  and `settings.plugins.tab` slots, settings form model.
- `…/dsh-persona/README.md` — persona prefix/suffix, `complete` replacing the whole system prompt.
- `…/dsh-experimental-client-ui-voice-input/README.md` — record → transcribe into the draft; no streaming
  playback, no barge-in.
- `…/dsh-action-cards/README.md` — propose an action, run nothing until the user acts.
- `…/dsh-attachment/README.md` — images only; "audio and video have no dedicated handling".

### External (primary, read 2026-11-06)

- Boson AI, *Higgs Realtime Duplex* — <https://www.boson.ai/blog/higgs-realtime-duplex>. 160 ms chunks,
  one front model that thinks, calls tools and delegates; backchannels, answers before you finish, stops
  when you cut in, ignores remarks not addressed to it; zero-shot voice/face from a reference clip and
  image; benchmarks including where it is not first; API "coming soon" with a waitlist.
- Pal-AI-Lab/Coopanion — <https://github.com/Pal-AI-Lab/Coopanion>. Pet-first entry, bubble guide, single
  status icon, babble with two clocks, settings pages, World extensions (QQ, Bilibili, Minecraft,
  websearch), privacy table, failure reporting after five consecutive model errors. Key sources:
  [`src/status.ts`](https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/src/status.ts),
  [`web/speech.js`](https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/web/speech.js).
- Pal-AI-Lab/Cortico — <https://github.com/Pal-AI-Lab/Cortico>. Four layers (Core/Persona/Memory/World);
  one World per environment with its own environment prompt and tools; built-in QQ, Bilibili, Minecraft and
  websearch worlds; delivery triggers `preempt`/`interrupt`/`flush`/`debounce`/`piggyback`;
  `deliver:false`; `endsTurn`/`barrierAfter`/`streamsOutput`; `onRunPhase`. From
  [`docs/worlds.md`](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/worlds.md).
- yetone/magpie — <https://github.com/yetone/magpie> and
  [`docs/reference.md`](https://github.com/yetone/magpie/blob/main/docs/reference.md). Local gateway at
  `127.0.0.1:3425` speaking four protocols with translation, streaming and tool calls; routing groups with
  `stays=` session affinity; intent routing by a small model per turn; decision models at
  `POST /v1/systemone`; image/video MCP tools; **normalised asynchronous video jobs** at `POST /v1/videos`,
  `GET /v1/videos/{id}`, `GET /v1/videos/{id}/content` with no normalised cancel; provider-specific
  operations through `/v1/magpie/native/…`. Deeper source inspection pinned to commit
  `12a9970d6ed9dca2943de519f9339923a56d3960` is recorded in [magpie-routing.md](magpie-routing.md),
  including the video job table, the absence of a normalised video cancel, and the classifier's own
  timeout/shared in-flight behaviour.

### Not verified this round

Rendering, screenshots, motion timing, audio output, microphone behaviour, echo suppression, device
compatibility, gateway behaviour, the DSH Desktop carrier, any latency figure, and — specifically — a
native media bridge from a thin Electron client into a DSH-hosted session. The DSH SDK/ACP stdio entry
points establish text and control connectivity only; capture, playback and barge-in signalling across that
boundary remain unproven.
