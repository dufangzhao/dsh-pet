import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect, it } from 'vitest';
import {
  COMPANION_MATERIAL_REF_SCHEMA,
  COMPANION_MESSAGE_CONTENT_SCHEMA,
  COMPANION_MATERIAL_IMAGE_MAX_BYTES,
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  COMPANION_FULL_TEXT_MAX_BYTES,
  COMPANION_VOICE_ATTACHMENT_MAX_MS,
  isCompanionMaterialRef,
  isCompanionInputMaterials,
  isCompanionMessageContent,
  type CompanionMaterialRef,
} from './companion-material.js';
const image: CompanionMaterialRef = {
  id: 'material-1',
  kind: 'image',
  name: 'picture.png',
  mediaType: 'image/png',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  durationMs: null,
  audience: { kind: 'person-private', principalId: 'person-1' },
  originInputIds: ['input-1'],
};
const ajv = new Ajv2020({ strict: true });
const refSchema = ajv.compile(COMPANION_MATERIAL_REF_SCHEMA);
const contentSchema = ajv.compile(COMPANION_MESSAGE_CONTENT_SCHEMA);
it('exposes verified references without bytes, URL, token or storage authority', () => {
  expect(refSchema(image)).toBe(true);
  expect(isCompanionMaterialRef(image)).toBe(true);
  for (const field of ['bytes', 'base64', 'url', 'relativePath', 'filePath', 'token', 'grant']) {
    expect(refSchema({ ...image, [field]: 'injected' })).toBe(false);
    expect(isCompanionMaterialRef({ ...image, [field]: 'injected' })).toBe(false);
  }
  expect(isCompanionMaterialRef({ ...image, audience: { kind: 'public' } })).toBe(false);
  expect(refSchema({ ...image, audience: { kind: 'public' } })).toBe(false);
});
it('separates per-image, file and aggregate-input budgets', () => {
  expect(isCompanionMaterialRef({ ...image, sizeBytes: COMPANION_MATERIAL_IMAGE_MAX_BYTES })).toBe(
    true,
  );
  expect(
    isCompanionMaterialRef({ ...image, sizeBytes: COMPANION_MATERIAL_IMAGE_MAX_BYTES + 1 }),
  ).toBe(false);
  const file = {
    ...image,
    kind: 'file',
    name: 'data.bin',
    mediaType: 'application/octet-stream',
    sizeBytes: COMPANION_MATERIAL_FILE_MAX_BYTES,
  };
  expect(isCompanionMaterialRef(file)).toBe(true);
  expect(isCompanionInputMaterials([file, { ...file, id: 'material-2', sizeBytes: 1 }])).toBe(
    false,
  );
  expect(isCompanionInputMaterials([image, image])).toBe(false);
  expect(
    isCompanionInputMaterials(
      Array.from({ length: 5 }, (_, i) => ({ ...image, id: `material-${i}` })),
    ),
  ).toBe(false);
});
it('requires real voice-duration metadata within the separate attachment bound', () => {
  const voice = {
    ...image,
    kind: 'voice',
    name: 'record.silk',
    mediaType: 'audio/silk',
    durationMs: COMPANION_VOICE_ATTACHMENT_MAX_MS,
  };
  expect(isCompanionMaterialRef(voice)).toBe(true);
  expect(isCompanionMaterialRef({ ...voice, durationMs: null })).toBe(false);
  expect(
    isCompanionMaterialRef({ ...voice, durationMs: COMPANION_VOICE_ATTACHMENT_MAX_MS + 1 }),
  ).toBe(false);
  expect(isCompanionMaterialRef({ ...voice, mediaType: 'image/png' })).toBe(false);
  // These are metadata boundary assertions, not evidence that bytes were decoded/encoded.
});
it('distinguishes an inline body from a bounded complete text document', () => {
  const material = {
    ...image,
    kind: 'text',
    name: 'reply.txt',
    mediaType: 'text/plain',
    sizeBytes: COMPANION_FULL_TEXT_MAX_BYTES,
  };
  const document = { kind: 'text-document', material };
  expect(contentSchema(document)).toBe(true);
  expect(isCompanionMessageContent(document)).toBe(true);
  expect(isCompanionMessageContent({ kind: 'inline-text' })).toBe(true);
  expect(isCompanionMessageContent({ ...document, completePreview: 'not the full body' })).toBe(
    false,
  );
  expect(
    isCompanionMessageContent({
      kind: 'text-document',
      material: { ...material, sizeBytes: COMPANION_FULL_TEXT_MAX_BYTES + 1 },
    }),
  ).toBe(false);
  expect(isCompanionMessageContent({ kind: 'text-document', material: image })).toBe(false);
});
