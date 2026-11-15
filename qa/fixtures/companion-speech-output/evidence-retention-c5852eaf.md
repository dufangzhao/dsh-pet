# Evidence retention record

Parent moved **27 intermediate/redundant files /5,163,691 bytes** to the ignored private evidence archive after all test instances closed. Every source and resolved absolute destination was checked before moving; all SHA256 values matched afterwards. **No file was deleted.** The final public set retains25 files /4,950,079 bytes from the inventory snapshot.

The [machine inventory](evidence-retention-c5852eaf.json) records all52 original filenames, sizes, SHA256 values, grouping and actual archive destinations. The [private archive manifest](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/manifest.json) duplicates that relocation receipt. Complete live private audio/report/freeze files are unchanged.

## Retained public evidence

- [Final native d71f3948](evidence/final-native-d71f3948.md): raw result, pre-run input map, two screenshots and summary.
- [Final Web c5852eaf](evidence/final-web-c5852eaf.md): raw result with embedded input maps, three screenshots and summary.
- [Core/Docker/ASR worker901](evidence/worker-901ed310.md): original result, assertion-window facts, independent cleanup audit, source/dependency maps and versions.
- [One-shot live MiMo result](evidence/live-mimo-43147468.md): safe raw result, outer comparison and summary. Its authorization is consumed.

## Preserved history

| Group | Recorded meaning | Private entry |
| --- | --- | --- |
| cc4d4e60 /8bd686c4 | Early profile/preference availability failure; no TTS playback claim | [Blocked checkpoint](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/native-blocked-8bd686c4.md) |
| 219cec3e | Generated profile manifest was overwritten by the authoritative build script; strict active check failed | [Generator checkpoint](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/native-blocked-219cec3e.md) |
| 119e6a84 | QA import error before any product/audio instance | [Original report](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/119e6a84-native.json) |
| 6bdb1aa0 | Formal reply observed before a reliably established new speech baseline; cause was not retroactively assigned | [Original report](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/6bdb1aa0-native.json) |
| 35fad705 | Four actual native cases passed before a later locator failure; not the final build's acceptance | [Partial checkpoint](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/native-checkpoint-35fad705.md) |
| be4d50e6 | Web behavior assertions passed but QA cleanup used nonexistent M4 diagnostic fields; actual exit1 retained | [Original report](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/be4d50e6-web.json) |
| 39e6412a | Successful software-null setup preflight without audio generation | [Preflight](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/39e6412a-null-preflight.json) |
| c5852eaf separate before-map | Redundant copy of the final raw's embedded input map; not a failed run | [Before-map](../../../.companion-data/qa-private/companion-speech-output/evidence-archive-c5852eaf/c5852eaf-web-before.json) |

Historical reports and Markdown retain their original bytes. Their original-path strings are interpreted using the machine inventory; relocating them does not rewrite past outcomes, add missing observations or turn partial runs into passes.
