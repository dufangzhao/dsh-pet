import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { errorMessage, type CompanionProfileView } from '@pet/contracts';

import { AgentLine, Conversation } from './chat.js';
import { ModelDialog } from './model.js';
import { CompanionClient } from './client.js';
import { ConnectForm } from './connect.js';
import { useClientState } from './hooks.js';
import type { ClientState } from './state.js';
import { ConnectionLine } from './status.js';
import { TaskStrip } from './tasks.js';
import { PersonaMemory } from './persona-memory.js';
import { VoiceInput, useVoiceInput } from './voice-input.js';
import { createVoiceSampler } from './voice-sampler.js';
import { createWebVoiceTransport } from './voice-web.js';
import { VoiceSettings } from './voice-settings.js';
import './persona-memory.css';
import './voice-input.css';

/** 服务在同一个源上托管 worklet；CSP 的 script-src 'self' 只认这个固定路径。 */
const WORKLET_URL = '/voice-capture-worklet.js';

export function App(): JSX.Element {
  const client = useMemo(() => new CompanionClient(), []);
  const state = useClientState(client);
  const [draft, setDraft] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<CompanionProfileView | null>(null);

  /**
   * 语音 owner 挂在 App 上：换视图、写草稿、开设置都不打断录音。
   *
   * 目标换一次就换一条 transport（客户端每次连接生成新的 clientId），
   * 旧采集的结果因此不会落到新目标上。采样器只做形状适配，设备仍在
   * `@pet/audio-capture/browser` 手里。
   */
  const voiceTarget = client.getVoiceTarget();
  const voiceTargetKey =
    voiceTarget === null ? 'none' : `${voiceTarget.clientId}:${voiceTarget.agentId}`;
  const voiceTransport = useMemo(
    () => (voiceTarget === null ? null : createWebVoiceTransport(client, voiceTarget)),
    // 换目标必须换 transport；client 实例本身不变。
    [client, voiceTargetKey],
  );
  const sampler = useMemo(() => createVoiceSampler(), []);
  const voice = useVoiceInput({
    transport: voiceTransport,
    sampler,
    workletUrl: WORKLET_URL,
    live: state.phase === 'live',
    targetKey: voiceTargetKey,
  });

  /**
   * 这份正文是按哪一个「服务 + 版本」读的。
   *
   * 只用 agentId 判断不够：同一个 Agent 的 profileRevision 会前进（别处改了人格），
   * 那时旧正文已经不是当前值。也记连接代，避免同一 id 重连后旧读结果落地。
   */
  const profileReadAt = useRef<{ agentId: string; revision: number } | null>(null);
  /** ref 变了不会重渲染，但 stale 判断需要跟着更新，所以同时存一份 state。 */
  const [readRevision, setReadRevision] = useState<number | null>(null);
  /** 每次发起读取都换代：只采纳属于当前这一代的结果。 */
  const profileGeneration = useRef(0);
  /** 只做 coalesce：同一 revision 不重复发请求。 */
  const profileInFlight = useRef<string | null>(null);
  /** 最近一次读取失败：给用户一个明确的重读入口，不自动循环。 */
  const [profileReadFailed, setProfileReadFailed] = useState(false);
  /** 手动重读：把 coalesce 键清掉，让 effect 真的再发一次。 */
  const [profileRetry, setProfileRetry] = useState(0);

  const agentId = state.snapshot?.agent.id ?? null;
  const canonicalRevision = state.snapshot?.agent.profileRevision ?? null;

  /**
   * 人格正文不放进每次刷新的快照里（它可能很长），所以按需显式读取。
   *
   * 同一个 Agent 的 revision 前进时必须真的重读，否则 web 永远停在旧正文：
   * 表单会拿旧 view 比较，外部改动提示出不来，也没有别的入口恢复。
   * 读取失败保留已读正文，由用户显式重试，不自动循环。
   */
  useEffect(() => {
    if (state.phase !== 'live' || agentId === null || canonicalRevision === null) {
      if (profileReadAt.current !== null) {
        profileReadAt.current = null;
        profileInFlight.current = null;
        profileGeneration.current += 1;
        setReadRevision(null);
        setProfile(null);
      }
      return;
    }
    const read = profileReadAt.current;
    const current =
      read !== null && read.agentId === agentId && read.revision === canonicalRevision;
    if (current) return;
    const key = `${agentId}:${canonicalRevision}`;
    if (profileInFlight.current === key) return;
    profileInFlight.current = key;
    const started = ++profileGeneration.current;
    void client.readProfile().then((result) => {
      // 只采纳仍然属于这一代、这一目标的结果：旧失败不能清掉新 view。
      if (profileGeneration.current !== started) return;
      if (profileInFlight.current === key) profileInFlight.current = null;
      if (result.ok) {
        if (result.value.agentId !== agentId) return;
        setProfile(result.value);
        profileReadAt.current = { agentId, revision: result.value.revision };
        setReadRevision(result.value.revision);
        setProfileReadFailed(false);
        return;
      }
      // 失败：留着已读正文（如果有），不置空、不把它当成「不支持」。
      setProfileReadFailed(true);
    });
  }, [client, state.phase, agentId, canonicalRevision, profileRetry]);

  /** 显式重读：只在用户点的时候发一次，不自动重试。 */
  const retryProfile = (): void => {
    profileInFlight.current = null;
    setProfileReadFailed(false);
    setProfileRetry((n) => n + 1);
  };

  /**
   * 已读正文落后于 canonical revision：仍然显示，但标出来等重读。
   * 置空会让组件以为这个 feature 不支持，外部改动提示也会一起消失。
   */
  const profileStale =
    profile !== null &&
    canonicalRevision !== null &&
    readRevision !== null &&
    readRevision !== canonicalRevision;

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
        onOpenModel={() => setModelOpen(true)}
        onOpenVoice={() => setVoiceSettingsOpen(true)}
        voiceAvailable={voiceTransport !== null}
      />
      <ModelDialog
        open={modelOpen}
        view={state.snapshot?.model ?? null}
        live={state.phase === 'live'}
        agentStatus={state.snapshot?.agent.status ?? null}
        transport={client}
        onClose={() => setModelOpen(false)}
      />
      <VoiceSettings
        key={voiceTargetKey}
        open={voiceSettingsOpen}
        view={voice.view}
        live={state.phase === 'live'}
        actions={
          voiceTarget === null
            ? null
            : {
                saveFeature: async (command) => {
                  const result = await client.saveVoiceSettings(command, voiceTarget);
                  voice.reload();
                  if (!result.ok) return { ok: false, error: errorMessage(result.error) };
                  return { ok: true, error: null, view: result.value };
                },
                saveProvider: async (command) => {
                  const result = await client.saveAsrProvider(command, voiceTarget);
                  voice.reload();
                  if (!result.ok) return { ok: false, error: errorMessage(result.error) };
                  return { ok: true, error: null, view: result.value };
                },
                writeCredential: async (command) => {
                  const result = await client.writeVoiceCredential(command, voiceTarget);
                  voice.reload();
                  if (!result.ok) return { ok: false, error: errorMessage(result.error) };
                  return { ok: true, error: null, view: result.value };
                },
                readCatalog: async (input) => {
                  const result = await client.readAsrCatalog(input, voiceTarget);
                  return result.ok
                    ? { ok: true, catalog: result.value }
                    : { ok: false, error: errorMessage(result.error) };
                },
              }
        }
        onClose={() => setVoiceSettingsOpen(false)}
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
        <Conversation
          state={state}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          voice={<VoiceInput controller={voice} />}
        />
        <Side
          state={state}
          client={client}
          profile={profile}
          profileStale={profileStale}
          profileReadFailed={profileReadFailed}
          onRetryProfile={retryProfile}
        />
      </div>
    </div>
  );
}

export function Header({
  state,
  onReconnect,
  onDisconnect,
  onOpenModel,
  onOpenVoice,
  voiceAvailable,
}: {
  state: ClientState;
  onReconnect: () => void;
  onDisconnect: () => void;
  onOpenModel: () => void;
  onOpenVoice: () => void;
  voiceAvailable: boolean;
}): JSX.Element {
  return (
    <header className="tc-head">
      <div className="tc-head__top">
        <AgentLine state={state} />
        <div className="tc-head__actions">
          {/* 只有服务真的提供了模型视图，才给这个入口；旧服务上不摆一个点了会空的按钮。 */}
          {state.snapshot?.model === undefined ? null : (
            <button type="button" className="tc-link" onClick={onOpenModel}>
              模型
            </button>
          )}
          {/* 语音设置与模型设置是两件事：这里只读语音自己的视图。 */}
          <button
            type="button"
            className="tc-link"
            onClick={onOpenVoice}
            disabled={!voiceAvailable}
            data-testid="open-voice-settings"
          >
            语音
          </button>
          <button type="button" className="tc-link tc-head__exit" onClick={onDisconnect}>
            断开
          </button>
        </div>
      </div>
      <ConnectionLine state={state} onReconnect={onReconnect} />
    </header>
  );
}

function Side({
  state,
  client,
  profile,
  profileStale,
  profileReadFailed,
  onRetryProfile,
}: {
  state: ClientState;
  client: CompanionClient;
  profile: CompanionProfileView | null;
  profileStale: boolean;
  profileReadFailed: boolean;
  onRetryProfile: () => void;
}): JSX.Element {
  const tasks = state.snapshot?.tasks ?? [];
  const snapshot = state.snapshot;
  // 记忆视图优先用快照里那一份（同一个 facts 数组，不复制）；没有 metadata 就是 null。
  const memory =
    snapshot === null || snapshot.memory === undefined
      ? null
      : { ...snapshot.memory, agentId: snapshot.agent.id, facts: snapshot.facts };

  return (
    <aside className="tc-side">
      <TaskStrip client={client} state={state} tasks={tasks} />
      {snapshot === null ? null : (
        <div className="tc-side__persona">
          <PersonaMemory
            transport={client}
            live={state.phase === 'live'}
            agentStatus={snapshot.agent.status}
            profile={profile}
            profileStale={profileStale}
            profileReadFailed={profileReadFailed}
            onRetryProfile={onRetryProfile}
            profileApplication={snapshot.agent.profileApplication}
            memory={memory}
            targetKey={snapshot.agent.id}
            onNotice={() => undefined}
          />
        </div>
      )}
    </aside>
  );
}
