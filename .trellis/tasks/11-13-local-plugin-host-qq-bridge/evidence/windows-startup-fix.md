# Windows QQ startup regression

## Root cause and direct evidence

The user ran preview8 on Windows and pressed the QQ page's start button. The UI reported `permission-denied` ("没有获得授权"). Running the shipped Windows PowerShell 5.1 helper with the catch block instrumented produced:

```text
FAIL:The term '//' is not recognized as the name of a cmdlet, function,
script file, or operable program. ... @line95
probe exit=1
```

The original [private-directory helper](../../../../packages/local-host/src/windows-private-directory.ps1) has a JavaScript/C# `//` comment on line95, outside its embedded C# here-string. PowerShell executes this as a command, so initialization stops before `CreateDirectory`. The `//` comments inside the C# here-strings in both Windows helpers are valid and must stay intact.

The user separately confirmed a local Fixed NTFS drive, no reparse points in the directory ancestry, the expected current-user owner of the application-data anchor, and successful `Add-Type` in Windows PowerShell 5.1. The anchor's inherited Administrators/other-user ACL entries are not the cause established by this failure: the helper only checks that anchor's owner before creating a protected child. No user ACL repair, administrator launch, profile deletion or OneDrive change is warranted by this evidence.

## Why the existing checks missed it

- Category D (test coverage gap): Linux TypeScript/tests and package byte/hash checks did not execute the Windows helper's initialization branch.
- Category E (implicit assumption): a C# comment style was used in the surrounding PowerShell program. A syntax-only parse is insufficient because PowerShell accepts `//` as a command token and fails at execution.
- Error propagation discarded native stderr and classified every non-special process failure as permission denial. The UI therefore hid a program defect behind an authorization message.
- Earlier chat hypotheses about path case, OneDrive, inherited anchor ACLs and probe encoding did not establish the cause. The later English exception plus its line number identifies the actual failing statement.

## Repair scope

Correct the PowerShell comment, check both shipped helpers for the same language-boundary mistake, and preserve every native owner/DACL/reparse/handle check. Propagate only bounded fixed diagnostic reasons through the existing error boundaries; never echo arbitrary exception text, paths or credentials. Align QQ-facing names with the supported clients without claiming that SnowLuma or NapCat has been detected, installed or started.

## Verification

- The new static regression was run against the unfixed source first: exit1 at `windows-private-directory.ps1:95`, with the exact `//` line reported. After the one-line comment repair it passes; embedded C# comments in both helpers remain legal.
- `pnpm --filter @pet/local-host typecheck` and `test`: exit0, 9 files / 39 passed + 1 skipped. The skipped case performs actual initialization plus directory/file verification when run on Windows, including under an ordinary inherited-ACL anchor; it is not described as executed on Linux.
- `pnpm --filter @pet/desktop test -- --run`: exit0, 121 files / 1144 tests. QQ client-name and internal-startup-error display regressions are included.
- Root lint and format checks: exit0 / exit0. An initial TypeScript diagnostic allowing a nullable native exit code and a needless regex escape were corrected before these final checks.
- The private helper now reports only allowlisted reason tokens to stderr. Recognized access-check failures remain `permission-denied`; unknown/script execution failures become `internal`; unsupported/missing/timed-out helper cases retain `not-ready`. `KernelError` remains exactly code/messageKey/retryable, without raw exception strings or additional protocol fields. The UI provides fixed contextual copy for `internal` instead of telling users to modify permissions.
- QQ names are maintained once by `qqClientLabel`: SnowLuma / NapCat（OneBot v11）, 官方 QQ 机器人, and unchanged unknown protocols. The card title is QQ 客户端接入. These labels do not attest that an external client was detected or installed.

Full-workspace `pnpm -r typecheck` completed with exit0. The new Windows package audit completed with source snapshot `037c871ad94bfd7cddf5f1cc40c28cd29d4a16c582e7adc283a8643f69295095` (1748 files). Preview9 ZIP SHA256 is `2c63caa225de7f043045536d30ddeaa6e8a2b66e3df01b16a65fba3faa9cae50`, 184354557 bytes. Both private-directory helper copies read directly from the ZIP are byte-identical to the repaired source (`63ba6b5de489969a9553456992428f224c04c7b4d065b35b38f754908ceb7be2`), including the `#` on line95. The parent independently verified SHA256, CRC, one top-level directory, safe paths, no symbolic links and both repaired helper copies. Detailed runtime/dependency audit remains in [G7 evidence](g7-package.md).

## Distribution and follow-up

Replace the preview8 candidate with a new versioned complete Windows ZIP. The user's next check should be a normal launch and the QQ start button, followed by GUI exit/reattach and explicit stop if startup succeeds. Actual Windows execution of the repaired artifact remains a user follow-up; Linux or static validation cannot establish that result. No real QQ message, paid-model request, service restart, commit or push is part of this repair.
