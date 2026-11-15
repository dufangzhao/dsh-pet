/**
 * 本机 QQ 接入区段：把接入卡、客户端表单、Agent 链路表单组合起来，持有草稿状态。
 *
 * 视图与命令全部用已落的 `DesktopLocalHostBridge`；这里不发明方法、不伪造成功。
 * 每个动作都带 captured target 与 per-operation token，迟回应不跨 target 落地。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
  errorMessage,
  type DesktopLocalHostBridge,
  type DesktopLocalHostState,
  type LocalAgentLinkView,
  type LocalHostConsoleMutation,
  type LocalHostConsoleView,
  type KernelError,
  type LocalHostSourceReview,
  type ManagedSourceSelector,
  type PermissionPreset,
  type Result,
  type QQSourceView,
} from '@pet/contracts';

import { LocalAgentLinkForm } from './local-agent-link-form.js';
import { LocalHostCard } from './local-host-card.js';
import { hostErrorText, type LocalHostFacts } from './local-host-view.js';
import {
  editLocalSource,
  followLocalSource,
  localSecretValid,
  localSecretTargetSaved,
  localSourceSaveCommand,
  rebaseLocalSource,
  seedLocalSource,
  typeLocalSecret,
  type LocalSourceDraft,
  type LocalSourceSecretDraft,
} from './local-source-draft.js';
import { LocalSourceForm } from './local-source-form.js';

import './local-host.css';

export interface LocalHostSectionProps {
  readonly bridge: DesktopLocalHostBridge | null;
  /** 当前界面自己的 companion 连接；`linkCurrentAgent` 用它代替手填内部 ID。 */
  readonly currentConnectionId: string | null;
  /** 当前界面自己那条连接是否 live；只用于文案，不门控本机接入的停止。 */
  readonly agentLive: boolean;
  /** server 策略仍在 Web；这里只转发一个已经带好捕获目标的打开动作。 */
  readonly openServerPolicy: (() => void) | null;
}

/**
 * 一次操作的归属：换进程、换客户端或换操作就作废。
 *
 * 生命周期动作（start/stop）在发起时可能还没有视图，所以 host/boot 允许为
 * null；但**一旦有**就必须匹配。这样「启动期间进程被换掉」也能挡住。
 */
interface OperationOwner {
  readonly hostId: string | null;
  readonly bootId: string | null;
  /** 两个 QQ 源或 Agent 连接；生命周期动作为 null。 */
  readonly protocol: ManagedSourceSelector | null;
}

const EMPTY_STATE: DesktopLocalHostState = {
  revision: 0,
  phase: 'stopped',
  view: null,
  error: null,
};

export function LocalHostSection({
  bridge,
  currentConnectionId,
  agentLive,
  openServerPolicy,
}: LocalHostSectionProps): JSX.Element {
  const [state, setState] = useState<DesktopLocalHostState>(EMPTY_STATE);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceDrafts, setSourceDrafts] = useState<Readonly<Record<string, LocalSourceDraft>>>({});
  const [secrets, setSecrets] = useState<Readonly<Record<string, LocalSourceSecretDraft>>>({});
  /** 每个受管源（两个 QQ 协议 + Agent 连接）各一份源码信任，互不借用。 */
  const [reviews, setReviews] = useState<Readonly<Record<string, LocalHostSourceReview>>>({});
  const [reviewErrors, setReviewErrors] = useState<Readonly<Record<string, string>>>({});
  const [agentSecret, setAgentSecret] = useState('');

  /**
   * **已被接受的最新状态**，作为「迟回应是否仍属于当前目标」的比较基准。
   *
   * 必须是 ref：闭包里的 `state` 是发起那一刻的值，拿它自比永远相等。
   *
   * 它只由 `accept()` 同步写入，**不在 render 里赋值**：render 里的 `state` 可能
   * 比已接受的状态旧（同一次提交里先采纳了新 boot，React 还没重渲染），
   * 让 render 回写就会把「已接受」倒退回「已渲染」，旧世界又能通过栅栏。
   */
  const latest = useRef(state);
  /** 每个动作一个令牌；只有令牌仍是当前那个，结果才落地。 */
  const operation = useRef<symbol | null>(null);
  /**
   * 每个源各一个读取令牌。
   *
   * 读取不像写入那样占全局 busy，所以必须按客户端作废：换进程、换 boot 或后一次
   * 读取都会让前一次迟到的 review 失效，旧 digest/epoch 不会贴到新世界上。
   */
  const reviewTokens = useRef<Partial<Record<ManagedSourceSelector, symbol>>>({});

  const view = state.view;
  const host =
    view === null ? null : { hostId: view.identity.hostId, bootId: view.identity.bootId };
  const sources = view?.sources ?? [];
  const agentLink = view?.agentLink ?? null;

  const ownerOf = useCallback(
    (protocol: ManagedSourceSelector | null): OperationOwner => ({
      hostId: host?.hostId ?? null,
      bootId: host?.bootId ?? null,
      protocol,
    }),
    [host],
  );

  /**
   * 结果是否仍属于发起时的目标。
   *
   * 换进程（含重启，bootId 变）、换客户端、或已有更新的操作，都不再落地。
   *
   * `owner === null` 表示这是一次**生命周期**动作（start/stop），发起时进程可能
   * 根本没有视图（停止状态）。这类动作只按令牌判新旧，不要求已有视图——
   * 否则「从停止状态启动」永远会被自己判成过期。
   */
  const stillOurs = useCallback((token: symbol, owner: OperationOwner): boolean => {
    if (operation.current !== token) return false;
    const current = latest.current.view;
    // 发起时没有进程：只要现在也还没有，这次结果就仍然属于当前世界。
    if (owner.hostId === null) return current === null;
    if (current === null) return false;
    return current.identity.hostId === owner.hostId && current.identity.bootId === owner.bootId;
  }, []);

  /** 采纳新状态：进程换了就无条件采纳（那是另一个世界），否则修订只增不减。 */
  const accept = useCallback((next: DesktopLocalHostState) => {
    const current = latest.current;
    const sameHost =
      current.view !== null &&
      next.view !== null &&
      current.view.identity.hostId === next.view.identity.hostId &&
      current.view.identity.bootId === next.view.identity.bootId;
    if (sameHost && next.revision < current.revision) return;
    if (!sameHost) {
      /*
       * 换进程（含重启、停止）时，所有 review 都属于另一个世界：清空并作废
       * 在途读取。迟到的旧 review 因此既不能显示，也不能再被拿去发命令。
       */
      reviewTokens.current = {};
      setReviews({});
      setReviewErrors({});
    }
    /*
     * 先同步更新 ref，再 setState：采纳与「栅栏看到的当前世界」必须是同一步。
     * 否则同一 microtask 里先采纳新 boot、旧 boot 的迟回应随后返回时，
     * 栅栏仍看到旧世界，`stillOurs` 会放行并把新 boot 覆盖回旧的。
     */
    latest.current = next;
    setState(next);
  }, []);

  /** 重读一次；onChanged 无参数，所以每次都整体重读。 */
  const reread = useCallback(async (): Promise<void> => {
    if (bridge === null) return;
    const result = await bridge.getState();
    if (result.ok) accept(result.value);
  }, [bridge, accept]);

  useEffect(() => {
    if (bridge === null) return;
    let cancelled = false;
    void bridge.getState().then(
      (result) => {
        if (!cancelled && result.ok) accept(result.value);
      },
      () => undefined,
    );
    const off = bridge.onChanged(() => {
      if (!cancelled) void reread();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge, accept, reread]);

  /** 进程身份变了或客户端列表更新时，重铺干净草稿。 */
  useEffect(() => {
    if (host === null) return;
    setSourceDrafts((current) => {
      const next: Record<string, LocalSourceDraft> = {};
      for (const source of sources) {
        const followed = followLocalSource(current[source.protocol] ?? null, source, host);
        if (followed !== null) next[source.protocol] = followed;
      }
      return next;
    });
  }, [host?.hostId, host?.bootId, sources]);

  /** 源换了或凭据版本变了，旧密钥立即作废。 */
  useEffect(() => {
    if (host === null) return;
    setSecrets((current) => {
      let changed = false;
      const next: Record<string, LocalSourceSecretDraft> = { ...current };
      for (const source of sources) {
        const secret = current[source.protocol];
        if (secret !== undefined && !localSecretValid(secret, source, host)) {
          delete next[source.protocol];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [host?.hostId, host?.bootId, sources]);

  /**
   * 接入生命周期动作（start/attach/stop）：返回整份状态。
   *
   * 结束后无论成败都重读一次：两段 CAS 可能只提交了一半，只有重读能说清实际状态。
   */
  const run = useCallback(
    async (
      owner: OperationOwner,
      work: () => Promise<Result<DesktopLocalHostState>>,
      failure: string,
    ): Promise<void> => {
      if (bridge === null) return;
      const token = Symbol('local-host');
      operation.current = token;
      setBusy(true);
      setNotice(null);
      try {
        const result = await work();
        if (!stillOurs(token, owner)) return;
        if (result.ok) accept(result.value);
        else setNotice(`${failure}（${errorMessage(result.error)}）`);
        await reread();
      } catch {
        if (stillOurs(token, owner)) setNotice(failure);
      } finally {
        if (operation.current === token) setBusy(false);
      }
    },
    [bridge, stillOurs, accept, reread],
  );

  /**
   * 配置类动作（源/凭据/链路）：返回变更后的视图与可能的错误。
   *
   * 即使 `error` 非空也采纳视图——那说明有一段已经提交，界面必须显示实际状态。
   */
  const mutate = useCallback(
    async (
      owner: OperationOwner,
      work: () => Promise<Result<LocalHostConsoleMutation>>,
      failure: string,
      /** 重读视图之后再刷新某个只读投影；仍在 busy 内，避免半截可点。 */
      after?: () => Promise<void>,
    ): Promise<void> => {
      if (bridge === null) return;
      const token = Symbol('local-host');
      operation.current = token;
      setBusy(true);
      setNotice(null);
      try {
        const result = await work();
        if (!stillOurs(token, owner)) return;
        if (result.ok) {
          accept({ ...latest.current, view: result.value.view });
          if (result.value.error !== null) {
            setNotice(`${failure}（${errorMessage(result.value.error)}）`);
          }
        } else {
          setNotice(`${failure}（${errorMessage(result.error)}）`);
        }
        await reread();
        if (after !== undefined) await after();
      } catch {
        if (stillOurs(token, owner)) setNotice(failure);
      } finally {
        if (operation.current === token) setBusy(false);
      }
    },
    [bridge, stillOurs, accept, reread],
  );

  /**
   * 读取某个受管源的源码状态。
   *
   * 读取不占全局 busy，所以用**按客户端**的令牌作废：换进程/boot、或同一客户端后一次
   * 读取，都会让前一次迟到的回应失效。失败时清掉该源旧 review 并显示真实错误，
   * 避免用户拿一份已经不成立的 digest/epoch 去发命令。
   */
  const readReview = useCallback(
    async (selector: ManagedSourceSelector): Promise<LocalHostSourceReview | null> => {
      const currentHost = latest.current.view;
      if (bridge === null || currentHost === null) {
        setReviewErrors((current) => ({
          ...current,
          [selector]: '本机接入未运行，先启动。',
        }));
        return null;
      }
      const captured = {
        hostId: currentHost.identity.hostId,
        bootId: currentHost.identity.bootId,
      };
      const token = Symbol('local-host-review');
      reviewTokens.current[selector] = token;
      let result: Result<LocalHostSourceReview>;
      try {
        result = await bridge.reviewSource({ ...captured, protocol: selector });
      } catch {
        result = { ok: false, error: makeReadFailure() };
      }
      // 换进程/boot 时 accept() 已作废全部读取令牌，所以这里只需比对令牌本身。
      if (reviewTokens.current[selector] !== token) return null;
      if (!result.ok) {
        setReviewErrors((current) => ({
          ...current,
          [selector]: `没能读取源码状态（${errorMessage(result.error)}）`,
        }));
        setReviews((current) => withoutKey(current, selector));
        return null;
      }
      setReviewErrors((current) => withoutKey(current, selector));
      setReviews((current) => ({ ...current, [selector]: result.value }));
      return result.value;
    },
    [bridge],
  );

  /**
   * 用户显式信任/撤销信任或选择权限预设。
   *
   * 命令里的 digest/epoch 一律来自**用户看到的这份 review**，不从 await 之后的
   * 新快照借值：confirmTrust 会让 permissionEpoch 递增，借用新值就会让下一次
   * allow 拿着一个没被用户确认过的基线通过。成功后只读重读该源，让新的
   * epoch/trusted/preset 由进程给出，而不是在界面里推算。
   */
  const changeTrust = useCallback(
    (
      selector: ManagedSourceSelector,
      capturedReview: LocalHostSourceReview,
      command: 'trust' | 'preset',
      value: boolean | PermissionPreset,
      failure: string,
    ): void => {
      const currentHost = latest.current.view;
      if (bridge === null || currentHost === null) return;
      const target = {
        hostId: currentHost.identity.hostId,
        bootId: currentHost.identity.bootId,
        protocol: selector,
        expectedDigest: capturedReview.digest,
        expectedPermissionEpoch: capturedReview.permissionEpoch,
      };
      void mutate(
        ownerOf(selector),
        async () => {
          if (bridge === null) throw new Error('no bridge');
          return command === 'trust'
            ? bridge.confirmSourceTrust({ ...target, trusted: value === true })
            : bridge.setSourcePreset({ ...target, preset: value as PermissionPreset });
        },
        failure,
        () => {
          // 提交期间换了进程：这次刷新属于另一个世界，交给新世界的显式读取。
          const now = latest.current.view;
          if (
            now === null ||
            now.identity.hostId !== target.hostId ||
            now.identity.bootId !== target.bootId
          )
            return Promise.resolve();
          return readReview(selector).then(() => undefined);
        },
      );
    },
    [bridge, mutate, ownerOf, readReview],
  );

  const actions = useMemo(
    () => ({
      start: () => {
        void run(
          ownerOf(null),
          async () => {
            if (bridge === null) throw new Error('no bridge');
            return bridge.start();
          },
          '没能启动本机 QQ 接入。',
        );
      },
      attach: () => {
        // start() 兼 start/attach 发现，界面上两个按钮走同一条真实路径。
        void run(
          ownerOf(null),
          async () => {
            if (bridge === null) throw new Error('no bridge');
            return bridge.start();
          },
          '没能连接到已在运行的接入进程。',
        );
      },
      stop: () => {
        if (host === null) return;
        void run(
          ownerOf(null),
          async () => {
            if (bridge === null) throw new Error('no bridge');
            return bridge.stop(host);
          },
          '停止没有完成，接入进程可能还在运行。',
        );
      },
      refresh: () => {
        void reread();
      },
      toggleSource: (protocol: QQSourceView['protocol'], enabled: boolean) => {
        const source = sources.find((item) => item.protocol === protocol);
        if (source === undefined || host === null || view === null) return;
        void mutate(
          ownerOf(protocol),
          async () => {
            if (bridge === null) throw new Error('no bridge');
            return bridge.setSourceEnabled({
              ...host,
              protocol,
              enabled,
              expectedControlRevision: view.sourcesRevision,
              expectedConfigRevision: source.configRevision,
              expectedCredentialVersion: source.credential.version,
            });
          },
          '没能改变这个源的启用状态。',
        );
      },
    }),
    [bridge, run, mutate, ownerOf, sources, host, view, reread],
  );

  return (
    <div className="local-host" data-testid="local-host-section">
      <LocalHostCard
        facts={hostFactsOf(state)}
        sources={sources}
        agentLinkPhase={agentLink?.phase ?? null}
        agentLinkTarget={
          agentLink === null ? null : `${agentLink.target.baseUrl} · ${agentLink.target.agentId}`
        }
        busy={busy}
        actions={actions}
        openServerPolicy={openServerPolicy}
      />

      {notice === null ? null : (
        <p className="field__error" role="alert" data-testid="local-host-notice">
          {notice}
        </p>
      )}

      {sources.map((source) => {
        const draft = sourceDrafts[source.protocol] ?? null;
        const secret = secrets[source.protocol] ?? null;
        return (
          <LocalSourceForm
            key={`${source.protocol}:${source.instanceId}`}
            source={source}
            draft={draft}
            review={reviews[source.protocol] ?? null}
            reviewError={reviewErrors[source.protocol] ?? null}
            secretValue={secret?.value ?? ''}
            secretUsable={host !== null && localSecretValid(secret, source, host)}
            busy={busy}
            onEdit={(change) => {
              setSourceDrafts((current) => {
                const next = editLocalSource(current[source.protocol] ?? null, change);
                return next === null ? current : { ...current, [source.protocol]: next };
              });
            }}
            onSecretChange={(value) => {
              if (host === null) return;
              setSecrets((current) => ({
                ...current,
                [source.protocol]: typeLocalSecret(
                  current[source.protocol] ?? null,
                  value,
                  source,
                  host,
                ),
              }));
            }}
            onReview={() => {
              void readReview(source.protocol);
            }}
            onTrust={(review, trusted) => {
              void changeTrust(
                source.protocol,
                review,
                'trust',
                trusted,
                trusted ? '没能记录源码信任。' : '没能撤销源码信任。',
              );
            }}
            onPreset={(review, preset) => {
              void changeTrust(source.protocol, review, 'preset', preset, '没能改变权限预设。');
            }}
            onSave={(command) => {
              void mutate(
                ownerOf(source.protocol),
                async () => {
                  if (bridge === null) throw new Error('no bridge');
                  if (host === null) throw new Error('no host');
                  return bridge.saveSource({ ...host, ...command });
                },
                '配置没有确认保存成功；请读取最新状态后再决定。',
              );
            }}
            onWriteSecret={(value) => {
              const target = host === null ? null : credentialTargetFor(host, source);
              void mutate(
                ownerOf(source.protocol),
                async () => {
                  if (bridge === null || target === null) throw new Error('no target');
                  return bridge.setSourceCredential({ ...target, value });
                },
                '密钥没有确认写入；请查看最新状态。',
              );
              // 发起即清空：界面不保留明文。
              setSecrets((current) => {
                const next = { ...current };
                delete next[source.protocol];
                return next;
              });
            }}
            onClearSecret={() => {
              const target = host === null ? null : credentialTargetFor(host, source);
              void mutate(
                ownerOf(source.protocol),
                async () => {
                  if (bridge === null || target === null) throw new Error('no target');
                  return bridge.setSourceCredential({ ...target, value: null });
                },
                '没能清除密钥。',
              );
            }}
            onRebase={() => {
              if (host === null) return;
              setSourceDrafts((current) => {
                const next = rebaseLocalSource(current[source.protocol] ?? null, source, host);
                return next === null ? current : { ...current, [source.protocol]: next };
              });
            }}
          />
        );
      })}

      <LocalAgentLinkForm
        view={agentLink}
        review={reviews['agent-link'] ?? null}
        reviewError={reviewErrors['agent-link'] ?? null}
        secretValue={agentSecret}
        busy={busy}
        currentConnectionId={currentConnectionId}
        agentLive={agentLive}
        onSecretChange={setAgentSecret}
        onLink={() => {
          if (host === null || currentConnectionId === null || agentLink === null) return;
          void mutate(
            ownerOf(null),
            async () => {
              if (bridge === null) throw new Error('no bridge');
              return bridge.linkCurrentAgent({
                ...host,
                connectionId: currentConnectionId,
                expectedRevision: agentLink.revision,
                expectedCredentialVersion: agentLink.credentialVersion,
              });
            },
            '没能把本机接入连接到当前 Agent。',
          );
        }}
        onWriteKey={() => {
          const target =
            host === null || agentLink === null
              ? null
              : {
                  ...host,
                  expectedRevision: agentLink.revision,
                  expectedCredentialVersion: agentLink.credentialVersion,
                };
          void mutate(
            ownerOf(null),
            async () => {
              if (bridge === null || target === null) throw new Error('no target');
              return bridge.setAgentCredential({ ...target, value: agentSecret });
            },
            '令牌没有确认写入；请查看最新状态。',
          );
          setAgentSecret('');
        }}
        onClearKey={() => {
          const target =
            host === null || agentLink === null
              ? null
              : {
                  ...host,
                  expectedRevision: agentLink.revision,
                  expectedCredentialVersion: agentLink.credentialVersion,
                };
          void mutate(
            ownerOf(null),
            async () => {
              if (bridge === null || target === null) throw new Error('no target');
              return bridge.setAgentCredential({ ...target, value: null });
            },
            '没能清除令牌。',
          );
        }}
        onReview={() => {
          void readReview('agent-link');
        }}
        onTrust={(review, trusted) => {
          void changeTrust(
            'agent-link',
            review,
            'trust',
            trusted,
            trusted ? '没能记录 Agent 连接的源码信任。' : '没能撤销 Agent 连接的源码信任。',
          );
        }}
        onPreset={(review, preset) => {
          void changeTrust(
            'agent-link',
            review,
            'preset',
            preset,
            '没能改变 Agent 连接的权限预设。',
          );
        }}
        onSetEnabled={(enabled) => {
          if (host === null || agentLink === null) return;
          /*
           * 启用/停用是 exclusive 的：服务端同时核 link 的 revision 与密钥版本，
           * 所以两个期望值都必须来自**发起这次操作时**看到的 view，
           * 不能等 await 之后从更新的快照里借一个更「新」的值。
           */
          const captured = {
            revision: agentLink.revision,
            credentialVersion: agentLink.credentialVersion,
          };
          void mutate(
            ownerOf(null),
            async () => {
              if (bridge === null) throw new Error('no bridge');
              return bridge.setAgentEnabled({
                ...host,
                expectedRevision: captured.revision,
                expectedCredentialVersion: captured.credentialVersion,
                enabled,
              });
            },
            '没能改变 Agent 链路的启用状态。',
          );
        }}
      />
    </div>
  );
}

/** console 状态 + 进程阶段 → 卡片需要的接入事实。 */
function hostFactsOf(state: DesktopLocalHostState): LocalHostFacts {
  const view = state.view;
  return {
    phase: state.phase,
    packageVersion: view === null ? null : view.identity.packageVersion,
    hostId: view === null ? null : view.identity.hostId,
    bootId: view === null ? null : view.identity.bootId,
    // running 且已有视图，说明连的是一个真实存在并上报状态的进程。
    attached: state.phase === 'running' && view !== null,
    error: state.error === null ? null : hostErrorText(state.error),
  };
}

/** 读取抛异常时构造一个固定错误，不把原始异常文本带到界面。 */
function makeReadFailure(): KernelError {
  return { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true };
}

/** 删除一个键并保持不可变，避免「读失败后旧 review 仍可点」。 */
function withoutKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** 源凭据目标：捕获当前进程身份与该客户端已保存的修订/凭据版本。 */
function credentialTargetFor(
  host: { readonly hostId: string; readonly bootId: string },
  source: QQSourceView,
): {
  readonly hostId: string;
  readonly bootId: string;
  readonly protocol: QQSourceView['protocol'];
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
} {
  return {
    ...host,
    protocol: source.protocol,
    expectedRevision: source.configRevision,
    expectedCredentialVersion: source.credential.version,
  };
}

/** 供测试与页面复用：从客户端与接入事实算出草稿，不涉及副作用。 */
export function seedDraftsFor(
  sources: readonly QQSourceView[],
  host: { readonly hostId: string; readonly bootId: string },
): Readonly<Record<string, LocalSourceDraft>> {
  const drafts: Record<string, LocalSourceDraft> = {};
  for (const source of sources) drafts[source.protocol] = seedLocalSource(source, host);
  return drafts;
}

/** 保存按钮是否可点（给测试用，规则与组件一致）。 */
export function canSubmitSource(
  source: QQSourceView,
  draft: LocalSourceDraft | null,
  busy: boolean,
): boolean {
  const command = localSourceSaveCommand(draft);
  return command !== null && !busy && source.source === 'ready';
}

export { localSecretTargetSaved };
export type { LocalHostConsoleView, LocalAgentLinkView };
