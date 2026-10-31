# Settings presentation handoff

| Page | Existing owner and real actions | Constraints carried into the preview and migration |
|---|---|---|
| Start | useStartModel/useModelConnection: selected provider, model list, effort, draft diagnostic, save/start; app pet visibility/pause | Query/test do not save or activate. Provider/Key invalidates old results. Browser auth shares fields; only Key differs. |
| Persona | useApplication: names, language/style, persona prompt; PersonaPromptEditor | Name/prompt draft + explicit CAS save. Saved/pending/applied remain separate host states. |
| Appearance | useApplication: figure/palette/size/window booleans; existing useTheme/editor | Same preferences feed native pet. UI theme/custom schemes retained; no shadow store. |
| Conversation | shared useApplication history + useDemo send/record | Ascending shared cursors, load earlier, 2000-char text, no second chat/history. No attachment/delete/export/new-session actions. |
| Voice | useDemo/useDemoSettings/useApplication | One recording lifetime across navigation, real model/cache/readiness, explicit end/recognition/send, pending/errors truthful. |
| Plugins/config | useConsoleSnapshot/usePluginActions/useStopAll/usePluginConfig | Per-owner actions/protected states, disable/uninstall/stop confirmation. No install/store/update/restart commands. Config is schema/CAS driven, dirty/conflict retained. |
| Permissions/data | useSecurity/useSecurityActions/useAudit | Exact owner/task/digest/request scopes; session trust separate from permissions; explicit source/restore confirmation; audit metadata only. Clear/export currently unavailable. |
| About | useConsoleSnapshot + native disclosure | Name/version/license and technical details; no unsupported update/telemetry/diagnostic upload. |

Source: apps/desktop/src/renderer/console/pages, settings-shell.tsx, console-app.tsx and their existing hooks. Capability mapping is source evidence, not a claim that a new presentation is already connected. Canonical runtime semantics remain in .trellis/spec/shared/plugin-application-contracts.md.
