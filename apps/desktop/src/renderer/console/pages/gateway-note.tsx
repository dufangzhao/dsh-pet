/**
 * 语音两项共用的「网关依赖」区。
 *
 * 只报事实：这个 provider 现在配的是哪个 Magpie 网关地址、它是否就绪。
 * ASR 与 TTS 都是经同一个网关出去的，所以这一段在两页上说的是同一件事，
 * 也就不各写一份。探测不在这里做：没有网关侧的健康检查通道，编一个就是假话。
 */
import type { JSX } from 'react';

import { Button, Card, Status, type StatusTone } from '../minimal-ui/controls.js';
import { Icon } from '../minimal-ui/icons.js';

export interface GatewayNoteProps {
  /** 该 provider 当前配置的网关地址；没有配置时是 null。 */
  readonly baseUrl: string | null;
  /** provider 的就绪度，原样交给下面那一句翻译。 */
  readonly readiness: 'unconfigured' | 'configured' | 'unavailable' | null;
  /** 跳到「模型」页：网关插件在那里启用、配地址。 */
  readonly onOpenModel: () => void;
}

/** 就绪度只翻成三个词；没读到就说没读到，不猜。 */
export function gatewayState(readiness: GatewayNoteProps['readiness']): {
  text: string;
  tone: StatusTone;
} {
  switch (readiness) {
    case 'configured':
      return { text: '已就绪', tone: 'ok' };
    case 'unconfigured':
      return { text: '还没配置完', tone: 'warn' };
    case 'unavailable':
      return { text: '不可用', tone: 'danger' };
    default:
      return { text: '未读取', tone: 'muted' };
  }
}

export function GatewayNote({ baseUrl, readiness, onOpenModel }: GatewayNoteProps): JSX.Element {
  const state = gatewayState(readiness);
  return (
    <Card title="网关依赖" testId="gateway-note">
      <div className="rows rows--tight">
        <div className="row">
          <span className="row__text">
            <span className="row__label">Magpie 网关</span>
          </span>
          <span className="row__value" data-testid="gateway-base-url">
            {baseUrl === null || baseUrl === '' ? '还没有配置' : baseUrl}
          </span>
        </div>
        <div className="row">
          <span className="row__text">
            <span className="row__label">就绪状态</span>
          </span>
          <span className="row__value" data-testid="gateway-state">
            <Status tone={state.tone}>{state.text}</Status>
          </span>
        </div>
      </div>
      <p className="card__note">
        语音输入与语音输出都经同一个 Magpie 网关；网关没配置好时，这两项都用不了。
      </p>
      <div className="card__foot">
        <Button
          size="small"
          icon={<Icon name="model" />}
          data-testid="gateway-open-model"
          onClick={onOpenModel}
        >
          打开模型页
        </Button>
      </div>
    </Card>
  );
}
