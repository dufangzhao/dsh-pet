import { useSyncExternalStore } from 'react';

import type { CompanionClient } from './client.js';
import type { ClientState } from './state.js';

/** 订阅客户端的已确认状态；状态对象整体替换，因此快照比较即可。 */
export function useClientState(client: CompanionClient): ClientState {
  return useSyncExternalStore(client.subscribe, client.getState, client.getState);
}
