import { randomUUID, createHash } from 'node:crypto';
import {
  checkInputGrant,
  inputScope,
  type RuntimeInputTerminal,
} from '../../../packages/companion-runtime/src/index.js';
import type { CompanionService } from '../../../apps/companion-service/src/service.js';

/** Synthetic UI records, using a real service-issued owner grant; this is not a model-generation test. */
export async function seedMaterialView(service: CompanionService) {
  const marker = `material-ui-fixture-${randomUUID()}`;
  let receive: (event: RuntimeInputTerminal) => void = () => {};
  const terminal = new Promise<RuntimeInputTerminal>((resolve) => {
    receive = resolve;
  });
  const off = service.runtime.onInputTerminal(async (event) => {
    if (event.admission.origin.kind !== 'owner') return;
    const message = await service.runtime.state('inputMessage', {
      id: event.admission.id,
      scope: inputScope(event.grant.origin),
    });
    if (message.text === marker) receive(event);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let event: RuntimeInputTerminal;
  try {
    await service.runtime.message({ commandId: randomUUID(), text: marker });
    event = await Promise.race([
      terminal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('owner fixture did not reach terminal')), 10000);
      }),
    ]);
  } finally {
    off();
    if (timer) clearTimeout(timer);
  }
  const grant = event.grant;
  await checkInputGrant(grant);
  const access = {
    scope: inputScope(grant.origin),
    signal: grant.signal,
    check: () => checkInputGrant(grant),
  };
  const fullText = '完整正文：这段来自真实材料，不是消息说明。🦜\r\n'.repeat(300);
  const notice = '完整回复已保存在附件中。';
  const document = await service.materials.storeFullText(
    { id: `ui-doc-${randomUUID()}`, text: fullText, origin: grant.origin },
    access,
  );
  const documentMessage = await service.runtime.state('appendMessage', {
    id: `ui-document-${randomUUID()}`,
    role: 'assistant',
    text: notice,
    inputId: event.admission.id,
    audience: grant.origin.audience,
    origins: [grant.origin],
    materials: [document],
    content: { kind: 'text-document', material: document },
  });
  const binary = Buffer.from([0, 1, 255, 128, 65, 66, 67, 10]);
  const file = await service.materials.put(
    {
      id: `ui-file-${randomUUID()}`,
      inputId: event.admission.id,
      kind: 'file',
      name: 'fixture-bytes.bin',
      mediaType: 'application/octet-stream',
    },
    (async function* () {
      yield binary;
    })(),
    access,
  );
  const fileMessage = await service.runtime.state('appendMessage', {
    id: `ui-file-message-${randomUUID()}`,
    role: 'assistant',
    text: '这是一个受控文件夹具。',
    inputId: event.admission.id,
    audience: grant.origin.audience,
    origins: [grant.origin],
    materials: [file],
  });
  return {
    documentMessageId: documentMessage.id,
    document,
    fullText,
    notice,
    fileMessageId: fileMessage.id,
    file,
    binarySha256: createHash('sha256').update(binary).digest('hex'),
  };
}
