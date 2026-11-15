/**
 * QQ 页：一张页面，两件事。
 *
 * 「服务端 QQ」是服务里那几个协议通道的状态与 Web 管理入口；「QQ 客户端接入」是
 * 这台机器上常驻、替本机 QQ 保持连接的那个进程。两者权威在不同地方，所以分成两张
 * Card，谁也不由谁推出谁。
 */
import type { JSX } from 'react';

import type { DesktopLocalHostBridge } from '@pet/contracts';

import type { CompanionView } from '../../shared/use-companion.js';
import { LocalHostSection } from '../local-host/local-host-section.js';
import { readLocalHostBridge } from '../local-host/read-bridge.js';
import { QQStatusCard, qqOf } from './qq-status.js';

export function QQPage({
  companion,
  bridge = readLocalHostBridge(),
}: {
  companion: CompanionView;
  bridge?: DesktopLocalHostBridge | null;
}): JSX.Element {
  return (
    <>
      <QQStatusCard
        qq={qqOf(companion.state?.snapshot ?? null)}
        connectionId={companion.state?.connectionId ?? null}
        openWeb={companion.openWeb}
      />
      <LocalHostSection
        bridge={bridge}
        currentConnectionId={companion.state?.connectionId ?? null}
        agentLive={companion.state?.phase === 'live'}
        /* openWeb 自己捕获当前 target，这里只转发，不传 URL 或令牌。 */
        openServerPolicy={
          companion.state?.connectionId == null ? null : () => void companion.openWeb()
        }
      />
    </>
  );
}
