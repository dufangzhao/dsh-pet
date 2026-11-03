# Ownership and decisions

Canonical implementation/status is maintained in [the live transcript and menu note](../../../docs/live-transcript-menu.md). Capture,ASR,Corehistory andtheme persistence retain their existing single owners. Livecapablelocal engines start once during capture; final-only engines start once after finish to preserve their finite task budget. Transcript UI is a separate immediate event from reply animation, and final remains inspectable.

Menu presentation owns no toggle state. Profile actions use existing CAS, pause uses existingCore.run, voice uses trusted fixedstart/stop, theme uses an exact-id publication acknowledgment to the existing hiddenConsole, and settings navigation chooses existing contributed pages. Source/generation/cancellation/permission scopes remain unchanged.
