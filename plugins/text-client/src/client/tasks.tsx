import type { JSX } from 'react';
import { StatusBadge } from '@pet/ui-kit';

import { clockTime, sizeLabel } from './format.js';
import type { ClientState } from './state.js';
import { isActive, taskStatusView } from './state.js';
import type { CompanionClient } from './client.js';
import type { CompanionTask } from '@pet/contracts';

interface TaskStripProps {
  readonly client: CompanionClient;
  readonly state: ClientState;
  readonly tasks: readonly CompanionTask[];
}

/**
 * 紧凑任务区：每行只放「状态 + 标题 + 该任务的动作」，完整日志折在 details 里。
 * 停止按钮只对非终态出现；点了以后显示「停止请求已发送」，直到服务端给出终态。
 */
export function TaskStrip({ client, state, tasks }: TaskStripProps): JSX.Element {
  return (
    <section className="tc-tasks" aria-label="任务">
      <div className="tc-tasks__head">
        <h2 className="tc-tasks__title">任务</h2>
        <span className="tc-tasks__count">{tasks.length}</span>
        {state.snapshot?.projection?.hasMoreTasks === true ? (
          <span className="tc-note">较早任务未列出</span>
        ) : null}
      </div>
      <ul className="tc-tasks__list">
        {tasks.map((task) => (
          <TaskRow client={client} state={state} task={task} key={task.id} />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({
  client,
  state,
  task,
}: {
  client: CompanionClient;
  state: ClientState;
  task: CompanionTask;
}): JSX.Element {
  const status = taskStatusView(task, state);
  const stop = state.stops[task.id];
  // 断线时任务状态未知，不提供停止：那会暗示我们知道它还在跑。
  const canStop = state.phase === 'live' && isActive(task.status);
  const logs = [task.stdout.trimEnd(), task.stderr.trimEnd()].filter(Boolean).join('\n');
  const hasDetail = logs !== '' || task.artifacts.length > 0 || task.exitCode !== null;

  return (
    <li className="tc-task">
      <div className="tc-task__line">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span className="tc-task__title">{task.title}</span>
        <span className="tc-task__meta">{clockTime(task.createdAt)}</span>
        {canStop ? (
          <button
            type="button"
            className="tc-task__stop"
            disabled={stop !== undefined}
            onClick={() => void client.requestStop(task.id)}
          >
            {stop === undefined ? '停止' : stop.uncertain ? '停止结果未知' : '已请求停止'}
          </button>
        ) : null}
      </div>

      {task.artifacts.length > 0 ? (
        <ul className="tc-task__artifacts">
          {task.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <button
                type="button"
                className="tc-link"
                disabled={state.phase !== 'live'}
                onClick={() => void client.downloadArtifact(artifact)}
              >
                {artifact.name}
              </button>
              <span className="tc-task__meta">{sizeLabel(artifact.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasDetail ? (
        <details className="tc-task__detail">
          <summary>详情</summary>
          {task.exitCode !== null ? <p className="tc-task__meta">退出码 {task.exitCode}</p> : null}
          {logs === '' ? null : <pre className="tc-task__log">{logs}</pre>}
          {task.logsTruncated ? <p className="tc-note">日志已截断，仅显示最近一段</p> : null}
        </details>
      ) : null}
    </li>
  );
}
