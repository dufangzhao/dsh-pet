# Source authority for service Harness ports

## Contracts

The host owns generic service control. A Harness using host-composed state, execution or model ports must also hold its own current-generation authority. The host's broad bootstrap grant is not the Harness's grant.

```ts
withSourceAuthority<T>(
  host: Pick<CompanionPluginHost, 'runFor' | 'permissions'>,
  sourcePluginId: string,
  permissions: readonly PermissionDeclaration[],
  operation: (signal: AbortSignal, context: TaskContext) => Promise<T>,
  options?: TaskOptions,
): Promise<T>

createAuthorizedModelClient(host, sourcePluginId, { baseUrl, apiKey })
```

`runFor` uses the existing host `TaskSupervisor` and tracking against the selected plugin's current owner. The helper acquires `PermissionKernel.authorize` leases for the requested source permissions inside that task. It combines the task and lease signals and passes the effective signal to the actual operation. Bounded state calls must propagate that signal. An accepted independent execution is a separate supervised root; the foreground signal must not become the accepted job's lifetime.

Private return values and native errors remain in the helper closure; only `null` enters the supervisor's JSON result. The helper awaits both logical result and actual settlement, closes all acquired leases, and rethrows the original operation error before translating a supervisor failure. This retains native `GenerationError` instances and partial responses when cancellation wins before cleanup. A successful operation still needs valid leases and a successful logical result before its return value is released.

## Provider authorization

The existing `capabilityPermissionAuthorizer` checks consumer `capability-use` and the provider's declared per-method permissions. A provider without `provides[].features.methodPermissions[method]` does not acquire a provider permission lease. Adding only top-level file declarations does not protect its invocation from provider deny/revoke or a changed source fingerprint.

The SQLite manifest declares plugin-data `read` for `snapshot`, `events`, `getTask`, `getTaskByExecution`, `getArtifact`, and `getCommand`; all seven mutating methods declare `read-write`. The Cortico manifest declares `read` for `status`, and `read-write` for `accept` and `stopForeground`. These provider leases stay inside the actual capability task and cover its selected provider generation and reviewed package fingerprint.

Cortico additionally declares optional state/execution consumers and corresponding `capability-use` permissions, plus credential key `model-api-key` for its host-provisioned transport. Optional consumption permits startup without an execution backend; it does not waive the permission required when the Harness calls that port.

## Model transport and secrets

The model client resolves the source owner inside each `runFor` task and passes that exact owner/task to `CredentialBroker.withSecretForHost`. The broker's existing `credentialPermissionAuthorizer` is the single source credential lease acquisition; the outer helper therefore receives an empty additional permission list for this path. Source policy revocation aborts the lease signal and the native HTTP request. Re-enabling/replacing the Harness causes the next borrow to use the new generation.

The transport still forwards caller cancellation, `onEvent`, and all private native generation options via the existing options spread. The broker intentionally replaces callback failures with credential errors, so the transport captures native errors and actual I/O work outside the broker callback, waits for cleanup, then rethrows the captured native error. Removing that capture loses partial-generation evidence.

The service registration explicitly supplies `hostCredentials: ['model-api-key']` to describe the supported private transport. Readiness requires this host-provided support for each declared key; this field neither grants permission nor replaces the manifest declaration. The API key remains operator-provisioned `suppliedSecret`: it is not saved in configuration, written to a ciphertext/plaintext credential file, or exposed as a generic SDK credential client. An in-memory store and intentionally unavailable cipher prevent accidental persistence. Secret-bearing provider events, generations and native errors are refused by the existing redactor checks.

## Focused regression coverage

The colocated source-authority tests use the real `CompanionPluginHost`, `PermissionKernel`, `TaskSupervisor`, manifest method declarations and in-process plugin definitions. They exercise source declaration denial, preserved private values/errors, physical cleanup after source revocation, state/Harness provider denial, provider revocation during work and changed provider fingerprints.

The model-client tests use the same real host/kernel plus a loopback HTTP/SSE fixture. They exercise successful native generation and private option forwarding, undeclared/denied/changed-source borrowing before network I/O, source revocation and caller cancellation during a partial stream, actual socket closure, current-generation borrowing after replacement, original native HTTP errors and secret-bearing error refusal. Each relevant test scans the isolated fixture files and result/error values for the operator-key canary. No paid API, existing desktop profile or production credentials are used.

Validated on Node `v26.13.0` after the host `runFor`, package export, source-aware model-client caller and explicit host credential-readiness seams landed:

- `pnpm --filter @pet/companion-runtime test -- src/source-authority.test.ts`: 10/10 passed.
- `pnpm --filter @pet/companion-service test -- src/model-client.test.ts`: 9/9 passed.
- Both affected packages' `typecheck` commands passed with existing strict compiler settings.
- Targeted ESLint and Prettier checks passed for the scoped source, tests and manifests.

The source-authority fingerprint test iterates the provider's exported `STATE_METHODS`, so newly added state methods must also declare a lease to remain protected.

These focused tests establish service authority and controlled native transport behavior, not live provider/account operation or deployment containment.
