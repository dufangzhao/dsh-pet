import { useEffect, useMemo, useState, type JSX } from 'react';
import { errorMessage } from '@pet/contracts';

import { AgentLine, Conversation } from './chat.js';
import { CompanionClient } from './client.js';
import { ConnectForm } from './connect.js';
import { useClientState } from './hooks.js';
import type { ClientState } from './state.js';
import { ConnectionLine } from './status.js';
import { TaskStrip } from './tasks.js';

export function App(): JSX.Element {
  const client = useMemo(() => new CompanionClient(), []);
  const state = useClientState(client);
  const [draft, setDraft] = useState('');

  useEffect(() => () => client.dispose(), [client]);

  // 草稿只在服务端确认受理后清空：结果未知时保留原文，重试才会复用同一 commandId。
  const submit = () => {
    const text = draft.trim();
    if (text === '') return;
    void client.submit(text).then((outcome) => {
      if (outcome === 'accepted') setDraft((current) => (current.trim() === text ? '' : current));
    });
  };

  // 还没拿到过任何快照（首次连接、或首次就失败）时停在令牌入口，
  // 这样认证失败可以直接换一个令牌，而不是进到一个空壳里。
  if (state.snapshot === null) {
    return (
      <ConnectForm
        pending={state.phase === 'connecting'}
        error={state.error === null ? null : errorMessage(state.error)}
        protocolMismatch={state.protocolMismatch}
        onConnect={(token) => void client.connect(token)}
      />
    );
  }

  return (
    <div className="tc-shell">
      <Header
        state={state}
        onReconnect={() => void client.reconnect()}
        onDisconnect={() => client.disconnect()}
      />
      {state.error === null ? null : (
        <p className="tc-banner" role="status">
          {errorMessage(state.error)}
        </p>
      )}
      {state.notice === null ? null : (
        <p className="tc-banner tc-banner--quiet" role="status">
          {state.notice}
        </p>
      )}
      <div className="tc-body">
        <Conversation state={state} draft={draft} onDraftChange={setDraft} onSubmit={submit} />
        <Side state={state} client={client} />
      </div>
    </div>
  );
}

function Header({
  state,
  onReconnect,
  onDisconnect,
}: {
  state: ClientState;
  onReconnect: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  return (
    <header className="tc-head">
      <div className="tc-head__top">
        <AgentLine state={state} />
        <button type="button" className="tc-link tc-head__exit" onClick={onDisconnect}>
          断开
        </button>
      </div>
      <ConnectionLine state={state} onReconnect={onReconnect} />
    </header>
  );
}

function Side({ state, client }: { state: ClientState; client: CompanionClient }): JSX.Element {
  const tasks = state.snapshot?.tasks ?? [];
  return (
    <aside className="tc-side">
      <TaskStrip client={client} state={state} tasks={tasks} />
    </aside>
  );
}
