# Live transcript and compact pet menu

The user requests live recognized speech in the pet bubble for checking, plus a Coopanion-style right-click panel matching the supplied216x165 reference with both light and dark variants. This is real implementation on the current native application.

## Acceptance

- [x] Live ASR text updates while capture remains recording; final text is inspectable after finish, without typewriter delay or status-toggle suppression.
- [x] Reuse one capture/session/ASR pipeline and preserve cancellation, owner identity, bounded audio and actual engine availability. Batch-only providers state their limits rather than invent partial results.
- [x] Compact right-click panel matches reference geometry, header and2x3 circular controls in both appearances, preserving original pet identity.
- [x] Existing chat/mic/pause/settings/quit and available audio/appearance controls are truly wired; unsupported reference actions are explicitly disabled.
- [x] Types/tests/full quality and serial native partial-transcript/menu/operation evidence pass; save locally.
