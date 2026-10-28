# Cortico published-release evidence

Planning research only. The npm registry entry for [cortico0.2.7](https://registry.npmjs.org/cortico/0.2.7) reports gitHead cb9ddbd685bcccba1f29905098648f46a79b3862, exactly the selected source revision, MIT license, Node>=22 and public subpaths ./* -> ./src/*. There is no root module export to assume.

The registry tarball integrity is sha512-/kTJ4S0/rXtDf7I/y08FkrA1V4yoMIuoqtbVFoJzPQyAJUHC64kYfsHWjj2+VZd+t8FCb1O4umtKNTPXBHtepQ==, with622 files and6,176,556 unpacked bytes. Its12 dependencies are7 application libraries plus5 type packages; the private source root Minecraft/canvas graph is not the published dependency list. The package still includes all src files, so desktop packaging must choose the actual required closure.

The [published file listing](https://unpkg.com/cortico@0.2.7/?meta) confirms the Core, generation, event-store, loop, transcript, provider registry and public page/panel TypeScript source entries. SHA-256 and byte size for LICENSE, core/core.ts, core/event-store.ts, core/generation.ts, providers/registry.ts and web/shared/webui-protocol.ts were computed from the pinned raw upstream source and matched the corresponding published-file metadata. Machine-readable details are in [cortico-release-provenance.json](cortico-release-provenance.json).

Coverage is intentionally explicit: registry and file-list metadata were read and six source entries compared. No tarball was downloaded or locally checked against its SHA-512; no registry signature/attestation was cryptographically validated; nothing was installed, built or executed. This is provenance/layout evidence, not a completed runtime acceptance gate.

## First execution gate after planning approval

Use the exact published version and lockfile integrity, with MIT attribution. Verify an ESM integration that supports the upstream .ts imports, provider-directory lookup and top-level await; the current CJS worker is not that integration. The candidate is either a downstream ESM artifact preserving verified module/resource layout or a supported ESM TypeScript runtime loader. Select one through the isolated actual-Electron probe; do not maintain speculative parallel loaders.

The probe must construct Core with actual provider metadata and a scripted full ResponseClient, round-trip event/tool/result/reply, interrupt/cancel, and confirm process shutdown. It must not call paid endpoints, mutate the running reference application, create a second agent loop, or misreport source inspection as runtime proof. Implementation remains gated by the current Trellis planning review.
