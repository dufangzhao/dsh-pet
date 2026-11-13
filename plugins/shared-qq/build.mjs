import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';
import { format, resolveConfig } from 'prettier';

const unregister = register();
try {
  const {
    QQ_FEATURE_PLUGIN_ID,
    QQ_ENTRY_CAPABILITY,
    QQ_PROTOCOL_CAPABILITY,
    QQ_POLICY_SETTINGS_SCHEMA,
    QQ_EXTERNAL_ACTOR_SCHEMA,
    VOICE_ASR_CAPABILITY,
    defaultQQPolicySettings,
  } = await import('@pet/contracts');
  const defaults = defaultQQPolicySettings();
  // ConfigService stores a bounded structural shape. The feature/controller applies the
  // canonical actor union and semantic guards; its config dialect has no oneOf/pattern.
  const storageSchema = structuredClone(QQ_POLICY_SETTINGS_SCHEMA);
  const [privateActor, groupActor] = QQ_EXTERNAL_ACTOR_SCHEMA.oneOf;
  const actor = {
    type: 'object',
    additionalProperties: false,
    required: ['account', 'scene', 'senderId'],
    properties: {
      ...privateActor.properties,
      ...groupActor.properties,
      scene: { type: 'string', enum: ['private', 'group'] },
    },
  };
  storageSchema.properties.privateAllowlist.items = structuredClone(actor);
  storageSchema.properties.knownMachineActors.items = structuredClone(actor);
  storageSchema.properties.principalAliases.items.properties.actor = structuredClone(actor);
  function structuralShape(schema) {
    delete schema.pattern;
    if (!schema.type) {
      const values = schema.enum ?? (Object.hasOwn(schema, 'const') ? [schema.const] : []);
      if (!values.length || !values.every((value) => typeof value === 'string'))
        throw new Error('Unmapped QQ config scalar');
      schema.type = 'string';
    }
    for (const child of Object.values(schema.properties ?? {})) structuralShape(child);
    if (schema.items) structuralShape(schema.items);
  }
  structuralShape(storageSchema);
  const properties = Object.fromEntries(
    Object.entries(storageSchema.properties).map(([name, schema]) => [
      name,
      { ...schema, default: defaults[name] },
    ]),
  );
  const capabilities = [
    QQ_PROTOCOL_CAPABILITY,
    'companion.state@1',
    'companion.model.connection@1',
    VOICE_ASR_CAPABILITY,
    'companion.speech.output@1',
    'companion.qq.codec@1',
  ];
  const manifest = {
    schemaVersion: 1,
    id: QQ_FEATURE_PLUGIN_ID,
    version: '0.1.0',
    displayName: { en: 'Shared QQ entry', 'zh-CN': '共享 QQ 接入' },
    description: {
      en: 'Service-owned QQ admission, participation and reply policy for the continuing Agent',
      'zh-CN': '同一 Agent 的 QQ 准入、参与和回复策略',
    },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'],
    entries: { runtime: 'dist/index.mjs' },
    provides: [
      {
        id: 'control',
        capability: QQ_ENTRY_CAPABILITY,
        features: {
          methodPermissions: {
            describe: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          },
        },
      },
    ],
    consumes: capabilities.map((capability) => ({ capability, optional: true })),
    permissions: [
      { kind: 'files', scope: 'plugin-data', access: 'read-write' },
      ...capabilities.map((capability) => ({ kind: 'capability-use', capability })),
    ],
    config: {
      version: 1,
      schema: { ...storageSchema, properties },
      apply: Object.fromEntries(Object.keys(defaults).map((name) => [name, 'immediate'])),
    },
  };
  const { prepareConfigDefinition } = await import('@pet/host-kernel');
  const prepared = prepareConfigDefinition(manifest.config);
  if (!prepared.ok || !prepared.value.validate(defaults).ok)
    throw new Error('QQ policy is not representable by ConfigService');
  const manifestPath = fileURLToPath(new URL('./plugin.json', import.meta.url));
  await writeFile(
    manifestPath,
    await format(JSON.stringify(manifest), {
      ...(await resolveConfig(manifestPath)),
      parser: 'json',
    }),
  );
} finally {
  await unregister();
}
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  packages: 'external',
});
