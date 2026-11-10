/**
 * 设置台的语音设置：一条连接上的语音偏好与 ASR 提供者。
 *
 * 与文字模型表单分开：保存语音设置不该改文字连接、重建 Core 或结束已受理的工作。
 * 密钥只能由服务操作员在服务侧写入（`credential.writable` 恒为 false），所以这里
 * 没有密码框，只如实说「由服务侧写入」。
 */
import { useEffect, useState, type JSX } from 'react';
import { VoiceSettings, type VoiceSettingsActions } from '@pet/text-client/voice-input-ui';
import { errorMessage, type VoiceAsrSettings } from '@pet/contracts';

import { Button, Card } from '../minimal-ui/controls.js';
import type { CompanionView } from '../../shared/use-companion.js';
import type { VoiceController } from '@pet/text-client/voice-input-ui';

import '@pet/text-client/voice-input.css';

export interface VoiceCardProps {
  readonly companion: CompanionView;
  readonly voice: VoiceController;
  readonly notify: (message: string, tone: 'ok' | 'danger') => void;
}

export function VoiceCard({ companion, voice, notify }: VoiceCardProps): JSX.Element {
  const state = companion.state;
  const [open, setOpen] = useState(false);
  const connectionId = state?.connectionId ?? null;
  const view = voice.view;
  const provider =
    view === null
      ? null
      : (view.providers.find((item) => item.providerRef === view.feature.providerRef) ?? null);

  // 换连接就关掉：这份表单属于那一条连接。
  useEffect(() => {
    setOpen(false);
  }, [connectionId]);

  const actions: VoiceSettingsActions | null =
    connectionId === null
      ? null
      : {
          saveFeature: async (command) => {
            const result = await companion.saveVoiceSettings(command);
            voice.reload();
            if (!result.ok) return { ok: false, error: errorMessage(result.error) };
            notify('语音偏好已保存。', 'ok');
            return { ok: true, error: null, view: result.value };
          },
          saveProvider: async (command: {
            providerRef: string;
            expectedRevision: number;
            settings: VoiceAsrSettings;
          }) => {
            const result = await companion.saveAsrProvider(command);
            voice.reload();
            if (!result.ok) return { ok: false, error: errorMessage(result.error) };
            notify('转写提供者已保存。', 'ok');
            return { ok: true, error: null, view: result.value };
          },
          // 桌面端同样只读目录；密钥写入这条通道根本不存在。
          readCatalog: async (input) => {
            const result = await companion.readAsrCatalog(input);
            return result.ok
              ? { ok: true, catalog: result.value }
              : { ok: false, error: errorMessage(result.error) };
          },
        };

  const summary =
    view === null
      ? '还没有读到语音设置。'
      : view.feature.source !== 'ready'
        ? '语音输入当前不可用。'
        : provider === null
          ? '还没有选择转写提供者。'
          : provider.readiness === 'configured'
            ? `可以录音 · ${provider.settings.modelRef}`
            : `未就绪：${provider.reason ?? '未知原因'}`;

  return (
    <Card
      title="语音输入"
      id="voice-card"
      action={
        <Button
          size="small"
          data-testid="voice-open"
          disabled={state === null || state.phase !== 'live'}
          onClick={() => setOpen(true)}
        >
          设置
        </Button>
      }
    >
      <p className="row__value" data-testid="voice-summary">
        {summary}
      </p>
      <p className="row__value">
        语音走它自己的提供者与密钥；保存这里不会改动文字连接，也不会结束正在进行的任务。
      </p>
      {open ? (
        <VoiceSettings
          key={connectionId ?? 'no-connection'}
          open={open}
          view={view}
          live={state?.phase === 'live'}
          actions={actions}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Card>
  );
}
