/**
 * 名单与映射的编辑区。
 *
 * 三条来自真实数据结构的规则：
 * 1. 名单是**按账号**存的：这里只显示/替换当前账号的条目，其他账号原样保留。
 * 2. 逗号分隔的文本只在**提交时**解析：输入过程中保留原始文本，
 *    否则尾逗号会被立刻吃掉、多项逐键输入不可用。
 * 3. 超上限是明确错误，不是静默截断。
 */
import { useEffect, useId, useState, type JSX } from 'react';
import { Button, EmptyState, Field, List, ListItem } from '@pet/ui-kit';
import type { QQAccountRef, QQPolicySettings } from '@pet/contracts';

import {
  actorKey,
  groupEntries,
  groupsFor,
  LIMITS,
  parseIdList,
  principalProblem,
  privateEntries,
  privateFor,
  removeAlias,
  replaceAdmins,
  toggleMachineActor,
  replaceGroupsFor,
  replacePrivateFor,
  upsertAlias,
  type QQPrivateEntry,
} from './qq-policy-edit.js';

export interface QQAllowlistProps {
  readonly settings: QQPolicySettings;
  /** 当前选中账号；名单只编辑它自己的条目。 */
  readonly account: QQAccountRef | null;
  readonly disabled: boolean;
  readonly onChange: (change: (settings: QQPolicySettings) => QQPolicySettings) => void;
}

/** 一行「原始文本 + 提交」。输入过程中不解析、不回写。 */
function IdListEditor({
  label,
  hint,
  initial,
  max,
  disabled,
  testId,
  onSubmit,
}: {
  label: string;
  hint: string;
  initial: readonly string[];
  max: number;
  disabled: boolean;
  testId: string;
  onSubmit: (ids: readonly string[]) => void;
}): JSX.Element {
  const id = useId();
  const joined = initial.join(', ');
  const [raw, setRaw] = useState(joined);
  const [problem, setProblem] = useState<string | null>(null);

  // 服务端值变了（并且我们没在编辑）：跟上它。
  useEffect(() => {
    setRaw(joined);
    setProblem(null);
  }, [joined]);

  const commit = (): void => {
    const parsed = parseIdList(raw, max, label);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    onSubmit(parsed.ids);
  };

  return (
    <>
      <Field label={label} hint={hint} {...(problem === null ? {} : { error: problem })}>
        {({ inputId, describedBy, invalid }) => (
          <input
            id={inputId || id}
            className="pk-input"
            aria-describedby={describedBy}
            value={raw}
            disabled={disabled}
            placeholder="用逗号分隔；输入完再点应用"
            {...(invalid ? { 'aria-invalid': true as const } : {})}
            data-testid={testId}
            onChange={(event) => setRaw(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
          />
        )}
      </Field>
      <div className="tc-qq__row">
        <Button size="small" disabled={disabled} data-testid={`${testId}-apply`} onClick={commit}>
          应用名单
        </Button>
      </div>
    </>
  );
}

export function QQAllowlists({
  settings,
  account,
  disabled,
  onChange,
}: QQAllowlistProps): JSX.Element {
  const mine = account === null ? [] : privateFor(settings, account);
  const groups = account === null ? [] : groupsFor(settings, account);

  return (
    <>
      {account === null ? (
        <p className="tc-qq__note" data-testid="qq-allowlist-no-account">
          还没有可用的账号，先配置并启用一个协议模块。
        </p>
      ) : (
        <p className="tc-qq__note" data-testid="qq-allowlist-account">
          当前只编辑 <strong>{account.accountId}</strong>（{account.protocol}）的名单；
          另一个账号的条目保持不变。
        </p>
      )}

      <IdListEditor
        label="允许的私聊"
        hint={`最多 ${LIMITS.private} 个，只作用于当前账号`}
        initial={mine.map((entry) => entry.senderId)}
        max={LIMITS.private}
        disabled={disabled || account === null}
        testId="qq-private-allowlist"
        onSubmit={(ids) => {
          if (account === null) return;
          onChange((current) => replacePrivateFor(current, account, privateEntries(account, ids)));
        }}
      />

      <IdListEditor
        label="允许的群"
        hint={`最多 ${LIMITS.group} 个，只作用于当前账号`}
        initial={groups.map((entry) => entry.groupId)}
        max={LIMITS.group}
        disabled={disabled || account === null}
        testId="qq-group-allowlist"
        onSubmit={(ids) => {
          if (account === null) return;
          onChange((current) => replaceGroupsFor(current, account, groupEntries(account, ids)));
        }}
      />

      <IdListEditor
        label="管理员"
        hint={`只有这些人能改长期记忆与全局设置，最多 ${LIMITS.admin} 个`}
        initial={settings.administratorPrincipalIds}
        max={LIMITS.admin}
        disabled={disabled}
        testId="qq-admins"
        onSubmit={(ids) => onChange((current) => replaceAdmins(current, ids))}
      />
    </>
  );
}

/* ---------------------------------------------------------------- 别名与机器 */

/** 从表单输入构造一个完整的外部 actor。 */
function actorFrom(
  account: QQAccountRef,
  scene: 'private' | 'group',
  senderId: string,
  groupId: string,
): { actor: Parameters<typeof upsertAlias>[1] | null; problem: string | null } {
  if (senderId.trim() === '') return { actor: null, problem: '要填发送者 ID。' };
  if (scene === 'group' && groupId.trim() === '')
    return { actor: null, problem: '群消息要填群 ID。' };
  return {
    actor:
      scene === 'group'
        ? { account, scene: 'group', senderId: senderId.trim(), groupId: groupId.trim() }
        : { account, scene: 'private', senderId: senderId.trim() },
    problem: null,
  };
}

export interface QQAliasEditorProps {
  readonly settings: QQPolicySettings;
  readonly account: QQAccountRef | null;
  readonly disabled: boolean;
  readonly onChange: (change: (settings: QQPolicySettings) => QQPolicySettings) => void;
}

/**
 * 把 QQ 用户显式绑到 principal，并标记已知的机器人。
 *
 * 这是 Q15 要求的「明确 principal 映射」：没有它，普通成员无法被识别成
 * 某个具体的人，机器人也会被当成人类参与者。
 */
export function QQAliasEditor({
  settings,
  account,
  disabled,
  onChange,
}: QQAliasEditorProps): JSX.Element {
  const [scene, setScene] = useState<'private' | 'group'>('private');
  const [senderId, setSenderId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = (known: boolean): void => {
    if (account === null) return;
    const built = actorFrom(account, scene, senderId, groupId);
    if (built.actor === null) {
      setProblem(built.problem);
      return;
    }
    if (!known) {
      const issue = principalProblem(principalId);
      if (issue !== null) {
        setProblem(issue);
        return;
      }
    }
    setProblem(null);
    onChange((current) =>
      known
        ? toggleMachineActor(current, built.actor!, true)
        : upsertAlias(current, built.actor!, principalId.trim()),
    );
    setSenderId('');
    setGroupId('');
    setPrincipalId('');
  };

  return (
    <>
      <p className="tc-qq__note" data-testid="qq-alias-hint">
        别名把一个 QQ 用户显式绑到一个 principal；被标成机器人的 actor 不会被当成人类参与者。
      </p>

      <Field label="场景">
        {({ inputId, describedBy }) => (
          <select
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            value={scene}
            disabled={disabled || account === null}
            data-testid="qq-alias-scene"
            onChange={(event) => setScene(event.target.value as 'private' | 'group')}
          >
            <option value="private">私聊</option>
            <option value="group">群聊</option>
          </select>
        )}
      </Field>

      <Field label="发送者 ID" hint="QQ 侧的用户标识">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            value={senderId}
            disabled={disabled || account === null}
            data-testid="qq-alias-sender"
            onChange={(event) => setSenderId(event.target.value)}
          />
        )}
      </Field>

      {scene === 'group' ? (
        <Field label="群 ID">
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              className="pk-input"
              aria-describedby={describedBy}
              value={groupId}
              disabled={disabled || account === null}
              data-testid="qq-alias-group"
              onChange={(event) => setGroupId(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      <Field label="principal" hint="要绑到的那个人的记录 ID">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            value={principalId}
            disabled={disabled || account === null}
            data-testid="qq-alias-principal"
            onChange={(event) => setPrincipalId(event.target.value)}
          />
        )}
      </Field>

      {problem === null ? null : (
        <p className="field__error" role="alert" data-testid="qq-alias-problem">
          {problem}
        </p>
      )}

      <div className="tc-qq__row">
        <Button
          size="small"
          disabled={disabled || account === null}
          data-testid="qq-alias-add"
          onClick={() => add(false)}
        >
          绑定为某人
        </Button>
        <Button
          size="small"
          variant="quiet"
          disabled={disabled || account === null}
          data-testid="qq-alias-machine"
          onClick={() => add(true)}
        >
          标记为机器人
        </Button>
      </div>

      {settings.principalAliases.length === 0 ? (
        <EmptyState title="还没有别名" description="没有绑定的用户不会被当成某个具体的人。" />
      ) : (
        <List label="已绑定的别名">
          {settings.principalAliases.map((entry) => (
            <ListItem
              key={actorKey(entry.actor)}
              title={`${entry.actor.scene === 'group' ? `群 ${entry.actor.groupId} · ` : ''}${entry.actor.senderId}`}
              description={`${entry.actor.account.accountId} → ${entry.principalId}`}
              trailing={
                <Button
                  size="small"
                  variant="quiet"
                  disabled={disabled}
                  data-testid={`qq-alias-remove-${actorKey(entry.actor)}`}
                  onClick={() => onChange((current) => removeAlias(current, entry.actor))}
                >
                  解除
                </Button>
              }
            />
          ))}
        </List>
      )}

      {settings.knownMachineActors.length === 0 ? null : (
        <List label="已知的机器人">
          {settings.knownMachineActors.map((actor) => (
            <ListItem
              key={actorKey(actor)}
              title={actor.senderId}
              description={actor.account.accountId}
              trailing={
                <Button
                  size="small"
                  variant="quiet"
                  disabled={disabled}
                  data-testid={`qq-machine-remove-${actorKey(actor)}`}
                  onClick={() => onChange((current) => toggleMachineActor(current, actor, false))}
                >
                  取消标记
                </Button>
              }
            />
          ))}
        </List>
      )}
    </>
  );
}

export type { QQPrivateEntry };
