# S5 final standalone Web summary — c5852eaf

**Passed: actual exit 0, three checks, unchanged before/after hashes.** Parent executed and collected this run. QA subsequently read the raw result and all three screenshots; this review did not rerun a browser, service, native test or model call.

Evidence: [raw result](./c5852eaf-web.json), [text roundtrip](./c5852eaf-web-typed-zero-TTS.png), [ASR review](./c5852eaf-web-ASR-review-zero-TTS.png), [review explicitly sent](./c5852eaf-web-review-sent-zero-TTS.png). All three images were opened with `read_image`. They show the synthetic production Web conversation, the unchanged unrelated draft, the ASR preview and the edited message/formal reply.

## Actual checks

| Scope | Observed result |
| --- | --- |
| Ready TTS provider, ordinary text | Existing authenticated service APIs configured selected `pet.tts-magpie/magpie` with a real nonempty binding, configured readiness, local client ID, controlled native PCM/Mia endpoint. Standalone production Web sent `S5文字回归-c5852eaf` once and displayed its formal scripted reply for the same Agent. No desktop/Pet was running. |
| Actual capture to controlled ASR, review before send | One real getUserMedia call, actual16000Hz AudioContext, production `/voice-capture-worklet.js`, real worklet and provider HTTP path. Four1600-sample chunks plus1280-sample tail total **7680 samples**, matching the native ASR WAV's15404bytes and observed sample count. Track state became ended, worklet emitted end/closed its port, context became closed. Preview was `受控测试转录`; entering review did not create a message or overwrite the unrelated draft. |
| Explicit preview edit/send, same Agent | User-flow editing to `受控语音输入，确认发送-c5852eaf` and explicit Send created one new canonical message/input ID and visible formal reply. Agent stayed `16befa6e-37b8-4da9-9f54-060225ca8e27`; unrelated draft `S5未发送草稿-c5852eaf` remained intact. One controlled ASR request total. TTS remained configured with the same binding. |

The actual independent input IDs were `68b3ba76-3aa6-4c72-9d05-1580db3000a4` for ordinary text and `31d9e43f-bb5b-4f33-8434-52d6aa414c4a` for the reviewed speech text. ASR request used own UA `dsh-pet-voice/1`; observed WAV SHA256 was `03ae15bd126788c6acb470f605e655501d3b72c9dbc156132f4a2d786c213e8e`.

## Zero TTS is distinct from the ASR graph

Across the executed flow, browser-context exact counters were:

- `/api/speech` request attempts **0**; external page request attempts **0**.
- AudioBufferSource creation/start attempts/starts **0 / 0 / 0**; HTML media play calls **0**.
- Ready TTS peer synthesis/catalog/rejected counts **0 / 0 / 0**.

The actual ASR AudioContext/worklet is positively present; it is not relabeled as a TTS player. Node's deliberate configuration/read APIs are outside the browser-only request counter. Native base-prototype observers delegate real functions and do not supply contexts, synthesize PCM, send ACKs or fake readiness. This is bounded execution evidence for these text/ASR flows, not an assertion about every possible future Web state.

## Environment and output routing

Actual built service entry at `http://127.0.0.1:45131`, scripted mode, independent data/child HOME. Actual private full Chrome **156.0.8078.4**, browser PID1956735, independent HOME. Synthetic16k fake input device and explicit microphone grant for that exact service origin were declared prerequisites; manual permission UI was not tested. No external ASR/TTS/key/account was used.

Private Pulse PID1956708 exposed only native Unix protocol plus one `qa_speech_null` module-null-sink, s16le2ch48000Hz. Actual sink-input PID1956864 was verified by ancestry to the owned browser and sink0. This is the ASR graph's software output routing, not evidence of TTS playback or hearing. The16k capture context and48k stereo sink are distinct rates. Default global audio mute was not substituted for routing; null-only ALSA fallback and explicit private Pulse settings were used.

## Actual cleanup

- Browser closed; verified sink inputs after browser closure **0**.
- Production service exited **0**.
- **M4 ASR peer:** awaited its real `close()`, then required loopback **ECONNREFUSED**. The probe socket's close event was joined. Its snapshot has no listener/socket/handler counters, so no nonexistent fields are invented or asserted zero.
- **M5 TTS peer:** awaited close, actual listening false/openSockets0/pendingHandlers0, plus joined loopback refusal probe.
- Owned Xvfb closed; private Pulse exited **0** and subsequent connection was rejected.

The first Web run be4d50e6 remains whole-run exit1 even though its three behavior checks passed: the original QA cleanup incorrectly assumed the M4 ASR snapshot exposed the M5 peer counters. Parent fixed only that QA contract check and failure-status reporting before c5852eaf. No old raw or product was rewritten to claim the first run passed.

## Exact executed build

The final raw embeds the complete selected before/after file maps; `hashesUnchanged:true`. Selected hashes:

| Input | SHA256 |
| --- | --- |
| Parent-corrected Web probe | `e4a212da6c2cabc2f4bc655690ab240d099aa51551a5778f82195fdafa3f7a2a` |
| Service production entry | `c664fa53fe34ee4aa7bbf3715fe06bd705604dbe46c713a6124e370b56afe3ad` |
| Production Web HTML | `c37070045fc09febe200ddd1aec2ad82cd5725e39d225a4981e2813c68c14b92` |
| Private full Chrome executable | `377a9fc07b495c3b8d0ab8ec1fdfd153641759f9756fea34d8dfce4de82f5025` |

This closes the planned standalone Web text/ASR/zero-TTS scope. It does not add native/physical hearing, manual permission, live quality, reasoning/notice/multisay or Core/Docker assertions. Native d71f3948 and independent worker evidence keep their separate scopes. Parent owns the separately completed one-shot live evidence and canonical acceptance; this summary neither reruns nor rewrites that section. No move/deletion, original4120/DSH data access or product/build modification was performed.
