# Media HTTP integration evidence

2026-11-13, implementation lookup. This records only the additional source facts needed during integration; the broader protocol matrix remains in the research files.

## Official inbound references

The current [group full-message event](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html) explicitly uses `GROUP_AND_C2C_EVENT (1<<25)` after the group enables receiving all messages. Its attachment example is `https://multimedia.nt.qq.com.cn/download?...&rkey=...`; no statement establishes a permanent lifetime or an exhaustive CDN host list.

The current [C2C event](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html) says repeated `msg_id` pushes require the current `message_scene.ext.msg_idx` for deduplication. The implementation's host event key includes the current display reference where supplied; it never substitutes the quoted `ref_msg_idx`, an outer gateway event ID, or a derived key into `msg_id`/`event_id`.

Both documents preserve nested `msg_elements[].attachments` and distinguish root author text from quoted content. The mapper traverses nested attachments and marks their provenance privately. Quoted audio transcription is current-input data, not authored text for a memory cue.

The C2C example includes `qpic.cn`/`gtimg.cn` material references; the official page footer uses Tencent COS (`myqcloud.com`). The application's fixed provider-domain download policy is a deliberate restriction, not proof that all possible QQ references use those domains. A domain outside the selected policy is unavailable until independently verified; it is not an arbitrary-URL fallback.

## Private transport boundary

Attachment reads require the captured native account/route plus a current participant check, source signal and byte limit. They do not carry QQ Bot Authorization or the service bearer. HTTPS, public-address resolution pinned into the actual connection, original Host/SNI, no redirect, bounded chunks and actual stream settlement are enforced by host IO.

Official upload preparation parses real pre-signed URLs inside the host and registers them against route/upload ID/part index. The plugin receives only validated geometry. A later PUT selects that registered part, never a model-supplied URL; COS receives no QQ Bot token. `file_info` remains private, while `file_uuid` may be recorded as a public upload fact.

These are public-document and controlled-implementation facts. No live QQ credential, recipient, installed SnowLuma endpoint or real model was used in this lookup.
