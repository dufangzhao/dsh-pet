import {
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type QQAccountRef,
  type QQProtocol,
  type QQSourceSettings,
} from '@pet/contracts';
import type { LocalQQSourceId } from './kernel.js';

/** The existing logical source/credential target rules, shared by local and service hosts. */
export function qqSourceId(protocol: QQProtocol): LocalQQSourceId {
  return protocol === 'official' ? QQ_OFFICIAL_PLUGIN_ID : QQ_ONEBOT_PLUGIN_ID;
}
export function qqSourceProtocol(id: string): QQProtocol | null {
  return id === QQ_OFFICIAL_PLUGIN_ID
    ? 'official'
    : id === QQ_ONEBOT_PLUGIN_ID
      ? 'onebot-v11'
      : null;
}
export function qqSourceTarget(settings: QQSourceSettings): string {
  return settings.protocol === 'official'
    ? JSON.stringify([settings.protocol, settings.appId])
    : JSON.stringify([
        settings.protocol,
        settings.accountId,
        settings.mode,
        settings.channelMode,
        settings.listenHost,
        settings.listenPort,
        settings.path,
      ]);
}
export function qqSourceAccount(settings: QQSourceSettings): QQAccountRef | null {
  const accountId = settings.protocol === 'official' ? settings.appId : settings.accountId;
  return accountId
    ? {
        protocol: settings.protocol,
        sourcePluginId: qqSourceId(settings.protocol),
        instanceId: 'default',
        accountId,
      }
    : null;
}
