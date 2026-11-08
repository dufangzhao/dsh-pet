# Cortico 0.2.7: provider-owned SSE framing floor

The version-scoped pnpm patch adds only `OpenAIHttpClient.eventCodeUnitsFloor` and its internal transport field. The default is 0, preserving the original `max_output_tokens * 12 * 2` (or default token budget) framing limit. Values must be safe integers from 0 through 65536; validation occurs once before I/O. The effective event/unfinished-line limit is the larger of the original calculation and this bounded floor.

The unit is **UTF-16 code units**, matching EventDecoder's JavaScript `string.length` and accumulated `data:` lengths; it is not a UTF-8 byte limit. The existing generated-output character guard and actual token request remain unchanged. The seam belongs to the provider, not arbitrary browser JSON or GenerateOptions.

Magpie 0.1.3225 returned legal `response.created`, `response.in_progress` and `response.completed` resources of roughly 23–24k code units during a 256-token diagnostic, exceeding the original 6144-unit frame limit. Only the Magpie adapter opts into 65536 units and separately recognizes its three observed nonstandard metadata sidebands. Standard events, strict assembly, native Generation/errors, retries/cancellation and drain remain upstream-owned.

The patch was prepared in an explicit pnpm edit directory and committed with offline/ignore-scripts configuration. Never modify installed node_modules by hand. Keep the exact `cortico@0.2.7` version/patch hash in the workspace and lockfile.

Remove the patch when a verified upstream version provides an equivalent bounded provider-owned framing seam. Re-run the default-vs-Magpie, large/non-ASCII frame, invalid-floor, unknown/error/missing-terminal, output-limit, abort/drain and source-authority regressions before removing it. It does not license discarding standard fields/events or raising the provider's output-token request.
