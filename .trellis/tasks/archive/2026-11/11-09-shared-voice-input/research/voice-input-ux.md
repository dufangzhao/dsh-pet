# Shared voice input: first-slice consumer and interaction plan

Read-only planning research, 2026-11-09. No product edit, build, install, device, microphone, service or model call was performed. Requirements live in the [child PRD](../prd.md); the exact provider/format contract belongs to GPT's design docs. This report covers **what the UI must consume and how it behaves**, not new DTOs.

## What already exists to reuse

| Piece | Source | What it gives us |
| --- | --- | --- |
| Renderer sampling | [microphone.ts](../../../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L19) | `getUserMedia` + 16 kHz AudioWorklet, frame/chunk discipline, tail flush on finish, explicit track/context teardown, fixed error reasons |
| Main permission + ticket | [demo-controller.ts](../../../../../../apps/desktop/src/main/demo-controller.ts#L626) | `beginRecording` issues a bounded ticket (token, sample rate, max/chunk samples) before any device opens |
| Talk-key gesture | [gesture.ts](../../../../../../plugins/talk-key/src/gesture.ts#L3) | Pure press-vs-hold rule; no session concept |
| Playback owner | [playback-owner.tsx](../../../../../../apps/desktop/src/renderer/speech-output/playback-owner.tsx#L5) | The single place that owns speaking today |
| Text submit | [chat.tsx](../../../../../../plugins/text-client/src/client/chat.tsx#L17) | Controlled draft + submit; the only working route to the Agent |
| Model settings | [model.tsx](../../../../../../plugins/text-client/src/client/model.tsx#L95) | Existing connector selection and save/test surface |

The capture chain is **split by design**: Main owns permission and lifecycle, the renderer owns the device call. The first slice keeps that split rather than inventing a third owner.

## What the first slice is

Record a bounded utterance, transcribe it through the configured Magpie route, and submit the resulting **text** as one ordinary message to the same Agent. Nothing about the message path changes: it is the same command, receipt and history.

Not in this slice: automatic TTS, background listening, wake words, duplex, barge-in, latency claims or recognition-quality claims.

## Interaction

One explicit control on each existing surface. No new page, route or window.

- **Start** — an explicit press. Desktop goes through Main's permission/ticket path; web relies on the browser permission prompt and requires a secure context.
- **While recording** — a visible recording state with elapsed/capacity feedback and a stop control. Only the **voice-transcription send path** is unavailable while the utterance is still audio; the existing text composer stays usable: [R19](../../../../11-06-unified-companion-architecture/prd.md#L29) keeps text interaction as the foundation, and recording does not suspend it. A transcript must never overwrite text the user typed in the meantime.
- **Finish** — stops capture, flushes the acknowledged tail, transcribes, then hands the text on. The default for this increment is decided: **finish-and-send**, one explicit action, one submit. An optional preview keeps the transcription editable before sending; a per-utterance confirmation gate is not required.
- **Cancel** — discards this capture and its transcription, joins the real release, and never submits late. Cancel is not the same action as finish, and neither is the same as stopping playback.
- **Thinking** — recording stays available. The existing composer is usable while a turn runs, and starting a recording does not stop the Core or any worker.
- **Provider/capture busy** — a concrete resource state with a reason, not a generic "not ready".

The three stop meanings must stay separate in code and copy: stop capture, stop playback, stop work.

## Readiness and discovery

A model catalog row is a **candidate**, not a capability claim. The UI must render, per candidate, one of:

- **configured** — this row is selected and its scoped key/route is in place;
- **available but not configured** — the row exists, nothing is selected;
- **unavailable** — the row exists but the route/key/format is missing or rejected.

Two honesty rules follow. An unsupported protocol or key must never render as ready, and a text-capable connector must not be shown as speech-ready merely because text works. [CompanionModelConnectorView](../../../../../../packages/contracts/src/companion-model.ts#L18) today carries `id/label/synthetic/configRevision/settings/model/credential` — **no role or `serves` field**, so the current view cannot distinguish an ASR candidate from a TTS one. That is a real gap for GPT's contract work, not something the UI can infer.

Discovery output must therefore be treated as "these refs came back", with role classification applied only where the contract actually says so.

Model settings also stay distinct from the base URL/token connection settings: selecting a transcription model is a model-role choice, not an endpoint change, and the two must not be merged into one form.

## States the UI must show

| State | Shown | True |
| --- | --- | --- |
| `idle` | Record control available or a reason it is not | No device open |
| `recording` | Recording indicator, capacity, stop | Device open, tracks live |
| `finishing` | "正在结束录音" | Tail flush and acks in flight |
| `transcribing` | "正在转写", no submit | Audio sent; text not yet final |
| `review` (optional) | Editable transcription | Text not yet submitted |
| `error` | The real reason plus a retry that does not auto-fire | Nothing submitted |

A silent gap is not `error`, and an empty transcript is an error rather than an empty message.

## Where it lives on each surface

Desktop puts the control beside the existing composer in the console conversation page, and the pet keeps its current text composer — the pet is a small window and a record control there competes with the character, so it can come later. The shared composition currently forbids the voice plugins, so whichever surface gets it first needs an explicit admission decision.

Web puts the control in the same composer row. Browser secure context and permission govern its microphone; it does not have a desktop Main microphone lease. The service still issues its separate capture/transcription ticket under the authenticated connection. Device permission and provider admission are different checks, and the UI describes the actual cause of unavailability.

Neither surface gains a route. The recorded audio never becomes a second conversation record: the message is the text.

## What the transcription result is allowed to do

The transcript becomes a message through the **existing message transport and outbox**, not by stuffing text into the composer and simulating a click. That keeps one command, one receipt, retry with the same command id on unknown outcome, and a new intent when the text changes. Partial or interim text never submits itself and never triggers tools or memory.

A pending or `unknown` message is **not** a reason to block voice. The existing client already keeps independent command ids and merges only the same id with the same payload, so a voice transcript takes its **own** id and travels the same outbox alongside an older unknown entry. That older entry stays retryable on its own id and payload, as a different intent running in parallel.

Two things still need explicit handling:

- **The outbox genuinely refuses** — real full quota, a refusal, or unavailable. Then the transcript is **retained** with its real state and a reachable retry, with **zero HTTP** sent. It must not overwrite an existing command, must not spawn an implicit queue, and must not auto-resend.
- **The user typed while recording** — their draft text is theirs. The transcription and the typed draft are separate values; neither overwrites the other.

If the user chose preview, the transcription is shown in its own editable field so they can adjust it before it is sent. Editing it there does not create a second copy of conversation history — the sent message remains the single canonical record.

## Real DOM acceptance

These run in a real browser and the real Electron window. A hook stand-in or static render does not count.

1. **Synthetic capture round trip** — with `--use-fake-device-for-media-stream` and controlled PCM, start → speak → finish produces a transcript that becomes one message. Assert tracks and AudioContext are released afterwards.
2. **Stop versus finish** — finish transcribes and submits; cancel discards and submits nothing, including after a delay.
3. **Late permission** — permission granted after the user already cancelled must not resurrect the capture; the late stream is stopped immediately.
4. **Retarget** — switching target mid-capture fences the old bytes and the old transcription; nothing lands on the new target.
5. **Uncertainty** — a lost transcription response is shown as unknown with the same retry intent, never as a silent success or a duplicate message.
6. **Minimum viewport** — the record control, states and errors remain reachable at 880×600 with no horizontal overflow.
7. **Cleanup** — after every terminal path, no `MediaStreamTrack` is live, no `AudioContext` is open and no worklet node remains connected.
8. **Typed draft survives recording** — type text, record, finish: the typed draft is unchanged and the transcription does not replace it. With another message still pending/unknown, the voice transcript still submits on its own id while that older entry remains separately retryable; only a real quota/refusal/unavailable leaves the transcript unsubmitted with a visible state and a working retry.

## Cleanup is part of the contract

Every path — finish, cancel, error, permission denial, retarget, unmount — must end in the same observable state: tracks stopped, context closed, worklet disconnected, pending acks settled or abandoned. The existing [microphone.ts](../../../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L19) already models this ordering for finish; the slice must not weaken it for cancel.

## Settled for this increment

These are no longer open product choices.

- **Review default is decided.** The first slice defaults to an explicit **finish-and-send**: one deliberate action transcribes and then submits exactly once. An optional preview can let the owner inspect the text first, but a per-utterance confirmation gate is not required. This is this increment's decision, not a placeholder.
- **Connector role metadata comes from the exact contract.** Role/`serves` classification will be supplied by the new voice/provider view GPT is defining; [CompanionModelConnectorView](../../../../../../packages/contracts/src/companion-model.ts#L18) does not have to carry it. The frontend waits for that handoff rather than inferring a role from text-connector fields.
- **Capture packaging is backend design work in progress.** Whether the working chain is extracted into a neutral consumer or kept as a Main-supervised path is being settled in the actual backend design. The frontend waits for the declared seam.

Also settled for this slice: starting a recording does **not** stop the Core or any worker, `thinking` does not disable recording, and TTS playback is not part of it. The **console root is the single capture owner** — no pet microphone and no cross-window relay; the exact DTO for that seam comes with GPT's contract handoff.
