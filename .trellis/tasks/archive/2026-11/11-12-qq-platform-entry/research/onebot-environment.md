# Existing OneBot environment — SnowLuma lead

User report2026-11-12: AstrBot is believed to connect to a deployed SnowLuma; the user believes its GitHub repository was recently taken down by Tencent. Exact installed version, endpoint/mode, capabilities and present operation have not been observed.

## Public observations, not deployment verification

- The original [SnowLuma/SnowLuma](https://github.com/SnowLuma/SnowLuma) URL could not be extracted in this research. This alone does not establish who removed it or why.
- The independent [qq-bridge project](https://github.com/Derpyu520/qq-bridge) publicly announces maintenance cessation and intended archive2026-11-18, attributing its decision to SnowLuma stopping public service/runtime availability. It explicitly says it is independent of SnowLuma/DSH/Tencent. This is a downstream maintainer statement, not a Tencent notice.
- A [third-party v2.3.4 source archive](https://git.fragrance.moe/shouko/SnowLuma/src/tag/v2.3.4) exists at archive commit `62bb85d2a1c186dc7e40c63a3ffc06be46f7d325`. Its README describes OneBot v11 WS server/client and HTTP server/reporting, and text/image/voice/file support. Its authenticity relative to an original release and the user's installed version are not established. No archive/binary was installed or executed.
- That archived README describes a source-available noncommercial license, explicitly not OSI open source, with separate EULA/native-component terms. Do not conflate it with AstrBot's AGPL license or copy/distribute its implementation as this project's MIT code.

## Design implications

The selected OneBot plugin remains an independently implemented protocol consumer. Do not depend on the unrelated qq-bridge/DSH integration or its credential discovery/SDK patching. Do not reimplement QQ login or silently migrate the existing deployment.

Standard OneBot identity/action/event semantics plus explicitly identified SnowLuma media extensions are the compatibility investigation target. The actual installed version and media paths still need a later authorized, read-only capability check and separately authorized test targets. An already running instance is neither proven broken nor proven safe/compatible by repository availability alone.

Candidate alternatives remain research, not selected replacements: [LuckyLilliaBot](https://github.com/LuckyLilliaDev/LuckyLilliaBot) currently declares OneBot11/Satori/Milky with visible source; [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) currently documents V2/Milky and identifies V1 as sunset. None has been installed, connected or verified for this task.
