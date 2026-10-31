# Selected-provider model discovery on Start

Move the reference Coopanion model-fetch workflow into our real Start page, next to the selected provider model field. Use the currently selected endpoint and typed API Key when supplied, otherwise its existing saved credential. A query only lists models: no saving, activating, diagnostic generation or paid message request. Keep manual model input. The user additionally requests reasoning effort and Test Connection in the same Start model block. Add default/low/medium/high effort, persist it through the existing endpoint config and pass it into real response protocols. Testing targets the current draft provider/model/Key/effort without saving or activating it; preserve honest failure and stale-result handling.

The legacy reference action sits in the old LLM settings panel; current reference code moved it to Providers. Our product has no duplicate model-fetch action to delete. Do not mutate the reference clone or copy its implementation. Implement the standard protocol using current owners and expose one fixed model bridge request. Frontend view changes belong to DeepSeek max; Main/hooks/contracts/integration remain parent-owned. Preserve provider branding and current UI layout.

Acceptance:
- [x] Start button fetches real selected-provider models with loading, failure and empty outcomes.
- [x] Typed unsaved or existing stored credentials work without persistence/activation changes or secret echo.
- [x] Provider/region/Key changes invalidate stale results; manual names remain usable.
- [x] Model selection fills the same existing draft used by Save and Start.
- [x] Boundary/protocol/async regressions plus controlled native Start flow pass; no live paid-account requests.
- [x] Reviewable local commits and task record, no push.
