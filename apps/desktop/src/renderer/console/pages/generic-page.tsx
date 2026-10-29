import { useState, type JSX } from 'react';

import type { ApplicationPage } from '@pet/contracts';

import { Button, Section } from '@pet/ui-kit';

import { COPY } from '../copy.js';
import type { ApplicationState, PageAction } from '../use-application.js';
import { PluginConfigPanel } from './plugin-config.js';

export interface GenericPageProps {
  page: ApplicationPage;
  app: ApplicationState;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * 外部扩展提供的一页：配置走现有 Schema 表单与同一套 owner 校验，
 * 操作只在宿主真的声明了 actions 时才出现。
 *
 * 加一页或撤一页都不需要改外壳的入口数组；这里也不替扩展编按钮。
 */
export function GenericPage({ page, app, onBack, onDirtyChange }: GenericPageProps): JSX.Element {
  const actions = page.actions ?? [];

  return (
    <>
      <PluginConfigPanel
        owner={page.owner}
        backLabel={COPY.backToRecovery}
        onBack={onBack}
        onDirtyChange={onDirtyChange}
      />
      {actions.length === 0 ? null : (
        <Section
          title="这一页能做的事"
          description="这些操作由扩展自己声明，点了才做；做完按宿主报回来的结果说。"
        >
          <PageActions page={page} app={app} actions={actions} />
        </Section>
      )}
    </>
  );
}

interface PageActionsProps {
  page: ApplicationPage;
  app: ApplicationState;
  actions: readonly PageAction[];
}

/** 一次只挡同一条重复点击；失败贴着它所在的那条操作，一次失败只出现一处。 */
function PageActions({ page, app, actions }: PageActionsProps): JSX.Element {
  const [state, setState] = useState<Record<string, { busy: boolean; error: string | null }>>({});

  const run = async (action: PageAction): Promise<void> => {
    const key = actionKey(action);
    if (state[key]?.busy) {
      return;
    }
    setState((current) => ({ ...current, [key]: { busy: true, error: null } }));
    const outcome = await app.runPageAction(page, action);
    setState((current) => ({
      ...current,
      [key]: { busy: false, error: outcome.ok ? null : (outcome.error ?? '没有完成。') },
    }));
  };

  return (
    <div className="pk-action-list">
      {actions.map((action) => {
        const key = actionKey(action);
        const current = state[key];
        return (
          <div className="pk-action" key={key}>
            <Button
              size="small"
              disabled={app.available === false || current?.busy === true}
              aria-busy={current?.busy === true}
              data-testid={`page-action-${action.panelId}-${action.method}`}
              onClick={() => void run(action)}
            >
              {current?.busy ? '正在执行…' : action.label}
            </Button>
            {current?.error === null || current?.error === undefined ? null : (
              <p className="pb-row__error" role="alert">
                这次没完成：{current.error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function actionKey(action: PageAction): string {
  return `${action.panelId}|${action.method}`;
}
