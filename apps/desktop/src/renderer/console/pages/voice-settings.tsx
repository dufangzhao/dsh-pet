/**
 * 语音输入页（ASR）：网关依赖 + 转写提供者。
 *
 * 语音偏好与提供者都挂在这一条连接上；网关地址来自该 provider 的 settings.baseUrl，
 * 不另存一份。密钥由服务侧写入，这里没有密码框。
 */
import type { JSX } from 'react';

import type { VoiceController } from '@pet/text-client/voice-input-ui';

import type { CompanionView } from '../../shared/use-companion.js';
import { GatewayNote } from './gateway-note.js';
import { asrProviderOf, VoiceCard } from './voice-card.js';

export function AsrPage({
  companion,
  voice,
  notify,
  onOpenModel,
}: {
  companion: CompanionView;
  voice: VoiceController;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  onOpenModel: () => void;
}): JSX.Element {
  const provider = asrProviderOf(voice.view);
  return (
    <>
      <GatewayNote
        baseUrl={provider?.settings.baseUrl ?? null}
        readiness={provider?.readiness ?? null}
        onOpenModel={onOpenModel}
      />
      <VoiceCard companion={companion} voice={voice} notify={notify} />
    </>
  );
}
