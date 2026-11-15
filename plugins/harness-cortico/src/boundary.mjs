import Ajv from 'ajv';
import {
  COMPANION_MEMORY_MAX_KEY_UNITS,
  COMPANION_MEMORY_MAX_VALUE_UNITS,
  COMPANION_MAX_CODE,
  COMPANION_MAX_TEXT,
  COMPANION_TASK_MATERIAL_MAX,
  COMPANION_INPUT_MATERIAL_MAX,
} from '@pet/contracts';

const id = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
};
const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const relativePath = {
  ...text(240),
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:/[A-Za-z0-9][A-Za-z0-9._-]{0,79})*$',
};

export const toolSchemas = {
  say: object(
    {
      inputId: id,
      text: text(COMPANION_MAX_TEXT),
      attachments: {
        type: 'array',
        maxItems: COMPANION_INPUT_MATERIAL_MAX,
        uniqueItems: true,
        description:
          'Image/file/text material IDs or completed own-task artifact IDs to include with this text.',
        items: object({ kind: { enum: ['material', 'artifact'] }, id }),
      },
    },
    ['inputId', 'text'],
  ),
  start_work: object(
    {
      inputId: id,
      title: text(160),
      code: text(COMPANION_MAX_CODE),
      files: {
        type: 'array',
        maxItems: 16,
        items: object({ path: relativePath, content: { type: 'string', maxLength: 24576 } }),
      },
      materials: {
        type: 'array',
        maxItems: COMPANION_TASK_MATERIAL_MAX,
        uniqueItems: true,
        description: 'Visible materials to copy into worker files.',
        items: object({
          materialId: id,
          inputName: {
            ...relativePath,
            description: 'Worker-relative destination, unique across files and materials.',
          },
        }),
      },
      outputs: {
        type: 'array',
        maxItems: 16,
        items: object(
          {
            path: relativePath,
            mediaType: { ...text(100), pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' },
          },
          ['path'],
        ),
      },
      timeoutMs: { type: 'integer', minimum: 100, maximum: 300000 },
    },
    ['inputId', 'title', 'code'],
  ),
  stop_work: object({ inputId: id, taskId: id }),
  remember: object({
    inputId: id,
    key: {
      ...text(COMPANION_MEMORY_MAX_KEY_UNITS),
      description: 'Short label, up to128 UTF-16 code units.',
    },
    value: {
      ...text(COMPANION_MEMORY_MAX_VALUE_UNITS),
      description:
        'Exact user-supplied text, up to2048 UTF-16 code units; do not paraphrase or remove qualifications.',
    },
  }),
  list_work: object({}),
};

const ajv = new Ajv({ strict: true });
const validators = Object.fromEntries(
  Object.entries(toolSchemas).map(([name, schema]) => [name, ajv.compile(schema)]),
);
const validateInput = ajv.compile(
  object(
    {
      id,
      text: text(COMPANION_MAX_TEXT),
      kind: { enum: ['user', 'work-result'] },
      taskId: id,
    },
    ['id', 'text', 'kind'],
  ),
);
const validateOptions = ajv.compile(
  object(
    {
      dataDirectory: text(4096),
      name: text(120),
      persona: text(16384),
      profileRevision: { type: 'integer', minimum: 1 },
      mode: { enum: ['scripted', 'model'] },
      model: text(128),
      baseUrl: text(2048),
    },
    ['dataDirectory', 'name', 'persona', 'mode'],
  ),
);

function check(validator, value, label) {
  if (!validator(value) || Buffer.byteLength(JSON.stringify(value)) > 60000) {
    throw new TypeError(`Invalid ${label}`);
  }
  return structuredClone(value);
}

export function parseInput(value) {
  const input = check(validateInput, value, 'Harness input');
  if (input.kind === 'work-result' && !input.taskId)
    throw new TypeError('Work result requires taskId');
  return input;
}

export function parseOptions(value) {
  const { client, ...config } = value;
  const options = check(validateOptions, config, 'Harness options');
  if (options.mode === 'model' && (!client || typeof client.respond !== 'function')) {
    throw new TypeError('Model mode requires a host-authorized ResponseClient');
  }
  if (options.mode === 'model' && !options.model)
    throw new TypeError('Model mode requires a configured model');
  if (options.baseUrl) {
    const url = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError('Model base URL must not contain credentials, query, or fragment');
    }
  }
  return { ...options, client };
}

export function parseTool(name, value) {
  const validator = validators[name];
  if (!validator) throw new TypeError('Unknown Harness tool');
  const parsed = check(validator, value, 'tool arguments');
  if (name === 'start_work' && parsed.materials) {
    const ids = new Set();
    const names = (parsed.files ?? []).map((file) => file.path);
    for (const selection of parsed.materials) {
      if (
        ids.has(selection.materialId) ||
        names.some(
          (name) =>
            name === selection.inputName ||
            name.startsWith(`${selection.inputName}/`) ||
            selection.inputName.startsWith(`${name}/`),
        )
      )
        throw new TypeError(
          'Material inputs must have distinct IDs and nonoverlapping destinations',
        );
      ids.add(selection.materialId);
      names.push(selection.inputName);
    }
    if (parsed.materials.length === 0) delete parsed.materials;
  }
  if (name === 'say' && parsed.attachments?.length === 0) delete parsed.attachments;
  return parsed;
}
