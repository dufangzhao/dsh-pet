# QQ entry options — evidence before the first scope decision

Read2026-11-12. This is planning evidence, not a transport selection or account/connection test. No service/account/message operation was performed.

## Current primary evidence

- [QQ official overview](https://bot.qq.com/) currently supports both WebSocket and Webhook. It explicitly describes WebSocket as not requiring a public callback server, suitable for personal/Agent use; Webhook delivers to a configured HTTPS endpoint.
- [Official WebSocket flow](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html) obtains a gateway endpoint, receives Hello, authenticates with `QQBot {AccessToken}` and selected intents, then receives READY/session identity. Heartbeat sequence and Resume replay are protocol facts that must be handled under one actual connection lifetime; a resumed event is not a new human command.
- [Official Webhook flow](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html) requires a configured HTTPS callback and signature validation. It is an alternative ingress with a different deployment requirement, not mandatory for all official bots.
- [AstrBot official QQ WebSocket guide](https://docs.astrbot.app/platform/qqofficial/websockets.html) recommends the official path and documents QR-assisted bot creation as well as manual AppID/Secret setup. Those are reference capabilities, not this project's selected first-release UX or permission to create/bind an account.
- [AstrBot OneBot guide](https://docs.astrbot.app/platform/aiocqhttp.html) supports OneBot v11 reverse WebSocket: AstrBot is the application/server and an implementation such as NapCat connects to it. The implementation owns the underlying QQ login; OneBot itself is the application interface standard.

QQ's current official overview governs current service-range/account rules when older integration tutorials disagree. User identity/certification, permitted private users/groups, group receive/active-send settings and API limits must be evaluated against the selected account. Do not hardcode old sandbox statements or infer unlimited messaging from adapter comments.

## Decision impact

| Option | Practical shape | Trade-off |
| --- | --- | --- |
| Official QQ WebSocket first | A dedicated official bot connects to the Agent service with outbound WSS; no public callback endpoint is required for this mode | Requires official bot credentials and the account's actual platform permissions |
| OneBot v11 first | The Agent plugin connects to a user-managed compatible QQ protocol implementation | Reuses that existing QQ setup, but relies on another running implementation for login/protocol behavior |
| Both in the first release | Separate selectable/removable protocol modules target the same Agent boundary | Broader authentication, lifecycle, routing and test scope; not implied merely by researching both |

The initial recommendation was official WebSocket first. The user subsequently selected **both official QQ WebSocket and OneBot v11 in the first release**; current product decisions are maintained in [the PRD](../prd.md). The comparison above remains the trade-off evidence.

## Existing project constraints that affect either option

The current [message command and message DTOs](../../../../../../packages/contracts/src/companion.ts#L49) carry no platform actor/conversation/reply target. [Publishing currently retains only the first input ID](../../../../../../packages/companion-runtime/src/runtime.ts#L1040). An external plugin therefore needs explicit canonical provenance and reply association; “send the latest assistant message to the last QQ sender” is not a valid plan.

The current operator bearer is a management authority, not QQ-sender authorization. Same Agent identity/memory does not grant every QQ user the owner's facts or tool/task permissions. Audience, trigger and trust/context visibility remain the next product decisions after transport scope.
