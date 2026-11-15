# G4 server media custody connection

Executed2026-11-14 (Asia/Shanghai), approved local-host bridge task. This report covers the server media connection and controlled legacy-native producer. The authenticated remote registry/facade and positive proactive ingress hook are Parent-owned follow-up integration; they are not simulated here by JSON grants or a lower-level protocol proxy.

## Actual connection

The server producer port is declared once in [qq-media-transfer](../../../../apps/companion-service/src/qq-media-transfer.ts):

```ts
interface QQInputMaterialDescriptor {
  kind: 'image' | 'voice' | 'file';
  name: string;
  quoted: boolean;
  expectedSizeBytes: number | null;
  expectedSha256: string | null;
}
interface QQInputMaterialProducer {
  account: QQAccountRef;
  parts: readonly QQInputMaterialDescriptor[];
  readPart(index: number, actor: RuntimeInputAccess,
    consume: (source: RawInputSource) => Promise<void>): Promise<void>;
}
```

`prepareProducedInput(input, producer, originalServerAccess, candidate?)` accepts safe descriptors and private callback ownership. A remote implementation must bind `readPart` to its authenticated original input/part/task and actual byteplane. No platform URL, native action dispatcher, token, file_info or gateway path is required by this server port. The explicit legacy adapter closes over its native attachments/references and uses the existing protocol driver, captured connection and TaskMediaPeer; those references do not become producer descriptors.

The preparation sequence now completes **every required raw part** through [G0 custody](g0-custody.md) before decode, ASR or any ready material write. A positive per-part custody proof is retained across source-only postflight failure; another required part still has to acquire its own proof. Post-custody processing consults only the original server actor/task and server file/model/codec permissions. There is no final `originalSource.check()` or socket signal across codec/ASR. Failure before the complete set cannot publish a partially ready first part. All retained raw handles are released after actual processing, including errors.

`prepareInput(input,mapped,source,access,candidate?)` retains its four-argument legacy call compatibility. Observed-file loading uses the same raw cut for a newly loaded resource; ready current-input canonical materials still verify/reuse without another native download. Worker names, code and binary reads remain the existing server path.

## Audio and bounded ownership

[QQAudio](../../../../apps/companion-service/src/qq-audio.ts) adds:

```ts
transcribeRaw({ inputId, materialId, name, custody }, originalServerAccess, candidate?)
```

The entire decode/ASR/original-material operation remains inside `withRawInput`. Fixed64KiB views reuse its already charged verified buffer, bounded to512 views for32MiB, plus a small format header. No second32MiB encoded copy is created for this path. Legacy `transcribe(encoded,access,candidate?)` shares the same recognition core. Exact duration still comes from real codec decode before canonical voice metadata; six existing20s ASR spans, complete transcript limits and quoted notes remain enforced.

QQMediaTransfer keeps two **whole preparations**, including raw staging, processing, ready puts and release. The store separately bounds raw reader subscopes to two, while canonical/raw-write preparations retain their two-slot bound; this avoids rejecting both nested canonical puts when two whole raw consumers are active. Every actual task/consumer still belongs to store close, and the shared128MiB reservation holds raw files/verified buffers until real release. There is no generic reentrant context, actor registry, content cache or detached stream.

## Proactive private contract

[qq-media-authority](../../../../apps/companion-service/src/qq-media-authority.ts) declares `QQProactiveMediaAuthority` containing the **existing server-issued RuntimeInputGrant**, original actor and scoped `StateObservation` snapshot. Validation requires reply-only rights, exact input origin, original group/account, observation audience and (at the legacy mapper boundary) exact original actor/observation ID. It only narrows existing check/signal access; it never creates a RuntimeInputGrant or inserts an actor/role into the public proactive origin. Proactive voice remains observation notes rather than authored instructions.

A public `qq-proactive` origin without this private candidate is refused before native IO/model use. No positive RuntimeInputGrant is fabricated in the tests. Parent must supply its actual `issuedGrant` and scoped observation at the ingress fifth parameter before positive proactive coverage can be claimed.

## Executed gates

| Gate | Actual result |
| --- | --- |
| Transfer file |24/24,32.08s,08:23; controlled HTTP, real QQController/drivers, TaskMediaPeer, State and material store |
| Audio file |22/22 as part of a33.01s combined run; actual pinned Docker codec and actual Magpie ASR/TTS plugins against controlled loopback providers |
| Store file |28/28 in the same combined run; original16 plus custody and two-whole nested-put capacity regression |
| Static checks | Final whole companion-service TypeScript, scoped ESLint, Prettier and diff whitespace all passed at08:35; focused original-actor/management-scope/disconnect/proactive-negative controls4/4 passed after the final scope guard |

Decisive new controls:

- Two required voice/file parts were both raw-committed (`.raw` count2), with zero ready material rows and zero ASR calls, while the real decode invocation was held. The original official source was then disabled. Releasing decode still completed actual codec/ASR, both canonical materials, a real State input commit and exact server-owned worker file bytes, without another download.
- At that same cut, withdrawing the original server actor stopped processing with zero ASR calls. Raw cleanup joined; no false successful input was returned.
- A later required file's invalid native completion prevented a first raw voice part from decoding/transcribing/publishing ready metadata. Actual aggregate32MiB refusal likewise left **all** canonical input material rows absent; the old partial-ready expectation was deliberately removed.
- The safe producer path used a real joined `ReadStream`; a source-only postflight exception after custody did not erase the positive server proof.
- The custody audio path staged a real120s WAV, retired the local read signal, then produced all six actual native ASR WAV requests:320000 samples each, frequencies220/293/366/439/512/585Hz, complete ordered transcript and original voice material. The unchanged legacy path passed the same measurement.
- Two raw consumers simultaneously committed canonical bytes successfully; actual reader/write scopes and original actor authority remained owned.
- Quoted/current transcription separation, body/hash/connection checks, identity-less observation loading/reuse/expiry/group scope, cleanup failure classification and M5 complete-text/120s gates retain their existing regressions.

Commands used only package-declared direct Node tools; no install, root lock change or global package repair was performed by this workstream. Controlled tests use isolated temporary roots. No real QQ/SnowLuma/AstrBot account, paid model, original4120 data or production deployment was involved.

## Observed-file producer extension (2026-11-14)

The remote historical OneBot file-notice path now has one private `QQObservedFileProducerFor` hook in [QQMediaTransferOptions](../../../../apps/companion-service/src/qq-media-transfer.ts):

```ts
type QQObservedFileResource = StateObservation & { readonly fileEvidence: QQFileEvidence };
type QQObservedFileProducerFor = (
  input: CompanionInputAdmission,
  observation: QQObservedFileResource,
  materialId: string,
  access: RuntimeInputAccess,
) => Promise<QQInputMaterialProducer>;

producerForObservedFile?: QQObservedFileProducerFor | 'service-local';
```

Only a scoped, current, not-yet-canonical observation reaches the hook. Existing canonical material/derived same-input resource lookup and verified reuse happen first and do not require an online producer or the old observation TTL. For a new load the server validates the actual input, observation scope, file evidence, original account/group, current group age, actor and aggregate budget. The input/observation snapshots passed to the hook are cloned and frozen. The returned producer must select the same account and exactly one nonquoted file descriptor with the evidence's name and nonnull reported-size assertion. It then uses the same raw-custody/original-actor processing path and stores `inputId` plus `observationId` before the worker receives a canonical selection ID.

An absent hook fails not-ready. Only the explicit `'service-local'` composition may invoke the legacy native driver. Remote hook failure, missing source, malformed account/descriptor or disconnect never falls back to that driver. Ordinary legacy fixtures now select this mode explicitly. No generic URL/HTTP or long-lived ticket is added.

Executed gate: transfer33/33 passed (27.07s at09:59), including9 new controls. They cover missing-strategy zero IO; exact input/observation/file-evidence/material binding; same-input reuse after local loss and TTL; remote-opener failure with zero legacy calls; expired/cross-group/metadata-only rejection before hook; another-account producer rejection; and local-loss versus original-actor-withdrawal after custody. These hook controls use a real controlled joined `ReadStream`, not a fabricated RuntimeInputGrant. Service TypeScript and targeted ESLint passed at09:57. Final static formatting/whitespace is checked separately.

The shared legacy opener is also available as the bound private `QQMediaTransfer.producerFromNativeObservation: QQObservedFileProducerFor`. The explicit `'service-local'` branch and a service-selected callback call this same method; it adds no second slot/ACL or RPC. A14:15 focused3/3 gate verified callback extraction with actual native group-file lookup/current-input canonical storage/reuse, the original explicit-local path, and remote-opener failure isolation. The added callback case is part of the current34-case file; the prior full33 receipt is not a34-case full rerun.

The actual registry and local-host fixed `file-evidence` selector are owned by the G3 workstream. This server closure and its controls do not establish that its two-process/native `downloadMedia` path has already been connected; that end-to-end claim remains pending the registry/selector acceptance. The hook passes actual State-scoped evidence for that purpose and never treats an observation ID as a native message ID.

## Remaining integration limits

The new server producer port is ready for the Parent's authenticated remote handle/byteplane adapter. These tests do not prove that G3 registry/facade, remote task mapping or real platform publication has already been connected. They also do not replace Parent's actual proactive candidate capture/positive test, cloud worker execution acceptance, Windows/device evidence or a later real-account trial. Native IO relocation/import updates are owned by the local-host workstream and were not duplicated here.
