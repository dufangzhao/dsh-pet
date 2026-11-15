/**
 * 语音输出页（TTS）：网关依赖 + 语音提供者与播放状态。
 *
 * 表单 owner 由这一页持有：网关区要显示同一个 provider 的 settings.baseUrl，
 * 两处读同一份，不挂第二个 hook、不另存一份地址。
 */
import type { JSX } from 'react';

import type { CompanionView } from '../../shared/use-companion.js';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';
import { SharedSpeechSettings } from '../minimal-ui/shared-speech-settings.js';
import { useSharedSpeech } from '../minimal-ui/use-shared-speech.js';
import { GatewayNote } from './gateway-note.js';

export function TtsPage({
  companion,
  presentation,
  onOpenModel,
  onOpenPlugins,
}: {
  companion: CompanionView;
  presentation: LocalPresentationView;
  onOpenModel: () => void;
  onOpenPlugins: () => void;
}): JSX.Element {
  const form = useSharedSpeech(companion);
  return (
    <>
      <GatewayNote
        baseUrl={form.provider?.settings.baseUrl ?? null}
        readiness={form.provider?.readiness ?? null}
        onOpenModel={onOpenModel}
      />
      <SharedSpeechSettings
        form={form}
        presentation={presentation}
        target={companion.state?.connectionId ?? null}
        onOpenPlugins={onOpenPlugins}
      />
    </>
  );
}
