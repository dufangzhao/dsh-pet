import { useState, type JSX } from 'react';

import { Button, Field, Section } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';
import type { DemoState } from '../use-demo.js';

export interface ModelsPageProps {
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  /** 回复方式与识别模型都在语音输入页设置；这里只负责密钥。 */
  onGoToVoice: () => void;
}

/**
 * 模型页：可选的真实 DeepSeek 接入。
 *
 * 这里唯一能确定地说出口的是"本机存下了这串字符"：能不能连通、额度够不够
 * 都要真实请求才知道，而这一批不发付费请求，所以界面不冒充验证过。
 */
export function ModelsPage({ demo, notify, onGoToVoice }: ModelsPageProps): JSX.Element {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const snapshot = demo.snapshot;

  const save = async (): Promise<void> => {
    const key = value.trim();
    if (key === '') {
      notify('没有保存：Key 是空的。', 'danger');
      return;
    }
    setSaving(true);
    const outcome = await demo.saveProviderKey(key);
    setSaving(false);
    if (outcome.ok) {
      setValue('');
      notify('Key 已保存；保存不等于已验证。', 'ok');
    } else {
      notify(`Key 没有存进去：${outcome.error ?? '未知原因'}`, 'danger');
    }
  };

  const remove = async (): Promise<void> => {
    setSaving(true);
    const outcome = await demo.removeProviderKey();
    setSaving(false);
    notify(
      outcome.ok ? '已移除本机的 Key。' : `移除失败：${outcome.error ?? '未知原因'}`,
      outcome.ok ? 'ok' : 'danger',
    );
  };

  return (
    <ConsolePane
      title="模型"
      summary="接入真实 DeepSeek 是可选项。识别模型与回复方式在「语音输入」页设置，那两处都不需要联网。"
    >
      <ConsoleStatus
        loading={demo.loading}
        error={demo.error}
        available={demo.available}
        onRetry={demo.refresh}
      >
        {snapshot === null ? null : (
          <>
            <Section
              title="DeepSeek Key"
              description="Key 只存在本机凭据存储里，不进配置文件，也不会写进日志。这里不做连接测试，所以界面只说“已保存”。"
            >
              <p className="plugin-row__hint">
                {snapshot.keyAvailable ? '凭据存储可用。' : '凭据存储不可用：现在存不进去。'}
              </p>
              <p className="demo-key-state" role="status">
                {snapshot.keyConfigured
                  ? '状态：已存有 Key（保存过不等于已验证）。'
                  : '状态：还没有 Key。'}
              </p>
              <Field
                label="API Key"
                description="粘贴 DeepSeek 的 Key；保存后输入框清空，不再回显。"
              >
                {({ inputId, describedBy, invalid }) => (
                  <div className="demo-key">
                    <input
                      id={inputId}
                      className="pk-input"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={value}
                      disabled={!snapshot.keyAvailable || saving}
                      data-testid="demo-key-input"
                      onChange={(event) => setValue(event.target.value)}
                    />
                    <Button
                      variant="primary"
                      size="small"
                      disabled={!snapshot.keyAvailable || saving || value.trim() === ''}
                      data-testid="demo-key-save"
                      onClick={() => void save()}
                    >
                      {saving ? '正在保存…' : '保存到本机'}
                    </Button>
                    <Button
                      size="small"
                      disabled={!snapshot.keyConfigured || saving}
                      data-testid="demo-key-remove"
                      onClick={() => void remove()}
                    >
                      移除本机 Key
                    </Button>
                  </div>
                )}
              </Field>
            </Section>

            <Section
              title="回复来源"
              description="离线脚本演示不需要 Key，也不需要网络；真实 DeepSeek 才用上面这串 Key。"
            >
              <div className="demo-check__actions">
                <Button size="small" data-testid="demo-go-voice" onClick={onGoToVoice}>
                  去语音输入页选择回复方式
                </Button>
              </div>
              <p className="console-muted">
                当前设置：
                {snapshot.settings.replyMode === 'deepseek' ? '真实 DeepSeek' : '离线脚本演示'}
                {snapshot.settings.readError !== null
                  ? '（读不到本机设置，先去语音输入页刷新）'
                  : ''}
              </p>
            </Section>
          </>
        )}
      </ConsoleStatus>
    </ConsolePane>
  );
}
