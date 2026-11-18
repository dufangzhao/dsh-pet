# Windows local-host acceptance evidence

Captured 2026-11-16 to 2026-11-18 on Windows 11 x64 with Electron 45.0.0. Each directory
holds the native probe's `report.json` and its `running.png`.

| Directory | Build | Result |
| --- | --- | --- |
| `windows-1569f47c-874a-4469-8f90-d7840d2d1721` | Packaged `0.1.0-preview.11` | `Windows-packaged-lifecycle-passed` |
| `windows-bc95c26e-85eb-4df3-b28a-bdf1a8e6812f` | Packaged `0.1.0-preview.10` | `Windows-packaged-lifecycle-passed` |
| `windows-44ae2bd4-0671-46d3-a2f7-4edc475547d4` | Development build | `Windows-development-lifecycle-passed` |

Every report records the same five checks: production Main/preload startup with the private
directory and role guards, actual three-source DOM trust with an authenticated native OneBot
peer ready, the GUI exiting while the independent native source still answers, reopening
with the same host/boot/source key idempotently, and an explicit stop with the server absent.
The development report does not claim to be the original packaged preview.9 ZIP. All three
are controlled loopback checks: no real QQ account, model, ASR or TTS call occurred.

The reports' `native.userData` values were reduced to repository-relative `.cache/...` paths
before publication. The hashes below cover the committed, sanitized copies.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `windows-1569f47c-874a-4469-8f90-d7840d2d1721/report.json` | 1563 | `7EE94698340D6F0F8FAECC67F3E6AB649DC26A6469C3FF39DC7E30B7C048219F` |
| `windows-1569f47c-874a-4469-8f90-d7840d2d1721/running.png` | 98278 | `3AD96C6A2D775210A0472160FE2CBF1D98E3DC134610D34C2A7E1FC48F16C839` |
| `windows-44ae2bd4-0671-46d3-a2f7-4edc475547d4/report.json` | 1636 | `6F0C93BF79D8DC2A86B5F3F49EEA67B718B2FBC1B62714A399E70873C8E00D8A` |
| `windows-44ae2bd4-0671-46d3-a2f7-4edc475547d4/running.png` | 98278 | `3AD96C6A2D775210A0472160FE2CBF1D98E3DC134610D34C2A7E1FC48F16C839` |
| `windows-bc95c26e-85eb-4df3-b28a-bdf1a8e6812f/report.json` | 1563 | `37A1EA722E2CA16534A69ACFF9646570DAA3A60336CC4FF2C3F631162282CEAC` |
| `windows-bc95c26e-85eb-4df3-b28a-bdf1a8e6812f/running.png` | 98278 | `3AD96C6A2D775210A0472160FE2CBF1D98E3DC134610D34C2A7E1FC48F16C839` |

The three screenshots are byte-identical and all show the same running local-host window
state. The reports' recorded `cleanup.stop` value is `ok:false` with `stale-owner`; each
report records `nativePeerClosed:true` and `guiClosed:true` separately.
