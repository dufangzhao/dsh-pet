/**
 * Start 自己的控件：目录怎么挑、Key 怎么填、回执怎么说、桌宠怎么管，全在这里画。
 *
 * 这里只用 original-ui 的那套板件（Button / Field / Toggle / Status / Notice / Tile / Disclosure），
 * 不导入 @pet/ui-kit，也不留旧的胶囊芯片、滑轨分段、pk-input、pk-pill。
 * 判断与状态一律来自 use-start-model：这一层只负责摆与点，不再算一遍"能不能保存"。
 *
 * 每个片段在一次渲染里只出现一份（同一个输入框、同一份回执）。版式负责摆放它们。
 */
import { useState, type JSX } from 'react';

import { Button, Field, Notice, Status, Tile, Toggle } from '../original-ui/kit.js';
import { OriginalPetPreview } from '../original-ui/pet-preview.js';
import { OriginalThemeStudio } from '../original-ui/theme-studio.js';
import { vendorIcon } from '../vendor-icons.js';

import { MARK_TEXT, activeNote, failureLine, providerNote } from './behavior.js';
import type { StartSlots } from './contracts.js';
import type { StartModel, StartOwners } from './use-start-model.js';

/* ------------------------------------------------------------------ 段落外壳 */

/**
 * 一节：左边一道规、上面名称与此刻的状态、下面是内容。
 * Start 用自己的这一段，不再借设置台的分组外壳——标题层级与状态牌是这套控件自己的。
 */
export function StartSection({
  className,
  title,
  note,
  status,
  actions,
  children,
  testid,
}: {
  className?: string;
  title: string;
  note?: string;
  status?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element | JSX.Element[] | null;
  testid?: string;
}): JSX.Element {
  return (
    <section
      className={'sc-section' + (className === undefined ? '' : ' ' + className)}
      data-testid={testid}
      aria-labelledby={'sc-' + title}
    >
      <header className="sc-section__head">
        <div className="sc-section__names">
          <h2 className="sc-section__title" id={'sc-' + title}>
            {title}
          </h2>
          {note === undefined ? null : <p className="sc-section__note">{note}</p>}
        </div>
        <div className="sc-section__aside">
          {status ?? null}
          {actions ?? null}
        </div>
      </header>
      <div className="sc-section__body">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------- 状态牌 */

/**
 * 此刻这台机器上的连接：在用哪家、有没有暂停回应。
 * 「已保存」与「在用」分开说，这里只报在用那一格；回执在表单下面另说。
 */
export function StartConnectionStatus({ model }: { model: StartModel }): JSX.Element {
  if (model.phase === 'no-bridge') {
    return (
      <div className="sc-statusline" data-testid="start-status">
        <Notice tone="warn" live={false}>
          这台机器还没有模型连接的通道，所以这里没有可填的表单。
        </Notice>
      </div>
    );
  }
  if (model.phase === 'read-failed') {
    return (
      <div className="sc-statusline" data-testid="start-status">
        <Notice
          tone="danger"
          action={
            <Button size="small" onClick={model.refresh}>
              重新读取
            </Button>
          }
        >
          {model.error ?? '这台机器的模型配置没读到。'}
        </Notice>
      </div>
    );
  }
  if (model.phase === 'loading') {
    return (
      <p className="sc-loading" data-testid="start-status">
        正在读这台机器的模型配置…
      </p>
    );
  }

  const tone = model.phase === 'in-use' ? 'ok' : model.phase === 'in-use-paused' ? 'warn' : 'off';
  const words =
    model.phase === 'in-use' || model.phase === 'in-use-paused'
      ? (model.snapshotLabel ?? '在用的那一家没报出名字')
      : model.phase === 'saved-only'
        ? '本机存过配置，还没在用'
        : '还没有在用连接';

  return (
    <div className="sc-statusline" data-testid="start-status">
      <Status tone={tone}>{words}</Status>
      {model.phase === 'in-use-paused' ? (
        <span className="sc-statusline__notice" data-testid="start-paused">
          回应已暂停
        </span>
      ) : null}
      {model.notice === null ? null : (
        <span className="sc-statusline__notice" data-testid="start-notice">
          {model.notice}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 服务目录 */

/** 一行的那一枚厂商图形：manifest 里没这一家就空着，名字本来就在文字上。 */
function ProviderMark({ service }: { service: string }): JSX.Element | null {
  const src = vendorIcon(service);
  if (src === null) {
    return null;
  }
  return <img className="sc-provider__mark" src={src} alt="" width={20} height={20} />;
}

/**
 * 挑一家：搜索 + 两种读法（井格目录 / 一行一家清单），默认目录。
 * 未接入的那一家看得见、点不动，原因写在 title 上——上一版确认过这个呈现，保留。
 */
export function StartProviderChooser({ model }: { model: StartModel }): JSX.Element {
  const [listMode, setListMode] = useState(false);
  const empty = model.choices.length === 0;

  return (
    <div className="sc-provider" data-testid="start-provider">
      <div className="sc-provider__bar">
        <Field
          className="sc-provider__search"
          label="找一家服务"
          hint="按名称、标识或可填的模型名筛，空白就是整份目录。"
        >
          {(control) => (
            <input
              id={control.inputId}
              aria-describedby={control.describedBy}
              className="pb-input"
              type="search"
              value={model.query}
              placeholder="例如 Kimi、glm、deepseek-flash"
              spellCheck={false}
              autoComplete="off"
              data-testid="model-provider-search"
              onChange={(event) => model.setQuery(event.target.value)}
            />
          )}
        </Field>
        <Button
          size="small"
          variant="quiet"
          data-testid="model-provider-toggle"
          onClick={() => setListMode((next) => !next)}
        >
          {listMode ? '改成井格目录' : '改成一行一家'}
        </Button>
        <span className="sc-provider__count" data-testid="model-provider-count">
          {model.choices.length + ' / ' + model.rows.length + ' 家'}
        </span>
      </div>

      {empty ? (
        <p className="sc-empty" data-testid="model-provider-empty">
          {'目录里没有匹配「' +
            model.query.trim() +
            '」的服务。改一个字试试，或去管理模型扩展看看这家接进来了没有。'}
        </p>
      ) : listMode ? (
        <ul className="sc-provider__list">
          {model.choices.map((choice) => (
            <li className="sc-provider__item" key={choice.service.id} data-mark={choice.mark}>
              <Tile
                selected={choice.current}
                leading={<ProviderMark service={choice.row.name} />}
                note={providerNote(choice.mark, choice.service.auth, choice.dirty)}
                disabled={!choice.service.available}
                title={choice.service.unavailableReason ?? choice.service.label}
                data-testid={'model-pick-' + choice.service.id}
                onClick={() => model.pick(choice.service.id)}
              >
                {choice.service.label}
              </Tile>
              <span className="sc-provider__meta">
                {choice.service.region === 'cn' ? '中国大陆平台' : '国际平台'} ·{' '}
                {choice.service.auth === 'browser' ? '用浏览器登录' : '填 API Key'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sc-provider__grid" role="group" aria-label="模型服务目录">
          {model.choices.map((choice) => (
            <Tile
              key={choice.service.id}
              selected={choice.current}
              leading={<ProviderMark service={choice.row.name} />}
              note={providerNote(choice.mark, choice.service.auth, choice.dirty)}
              disabled={!choice.service.available}
              title={choice.service.unavailableReason ?? choice.service.label}
              data-testid={'model-pick-' + choice.service.id}
              onClick={() => model.pick(choice.service.id)}
            >
              {choice.service.label}
            </Tile>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 回执的三条 */

/**
 * 写进本机、探测过没过、这台机器现在用不用它——三条事实分开摆，不合成一句"已连接"。
 * 只有一次真实回执之后才出现；没测过就说没测过。
 */
function SaveReceiptBoard({ model }: { model: StartModel }): JSX.Element | null {
  const receipt = model.saved;
  if (receipt === null) {
    return null;
  }
  // 「现在在用」按此刻的真实 active 说：没有在用就说没有在用，别推给"别的一家"。
  const who = activeNote({
    receiptActive: receipt.active || model.activeId === model.saveTargetId,
    activeId: model.activeId,
    activeLabel: model.activeLabel,
    writtenId: model.saveTargetId ?? '',
  });
  return (
    <dl className="sc-receipt" data-testid="model-receipt">
      <div className="sc-receipt__row" data-state={receipt.saved ? 'ok' : 'danger'}>
        <dt>写进本机</dt>
        <dd>
          <Status tone={receipt.saved ? 'ok' : 'danger'}>
            {receipt.saved ? '已保存' : '没保存'}
          </Status>
        </dd>
      </div>
      <div className="sc-receipt__row" data-state={receipt.tested ? 'ok' : 'warn'}>
        <dt>这一次探测</dt>
        <dd>
          <Status tone={receipt.tested ? 'ok' : 'warn'}>
            {receipt.tested ? '通过' : '没通过'}
          </Status>
        </dd>
      </div>
      <div className="sc-receipt__row" data-state={who.tone}>
        <dt>现在在用</dt>
        <dd>
          <Status tone={who.tone === 'warn' ? 'off' : who.tone}>{who.text}</Status>
        </dd>
      </div>
      <p className="sc-receipt__line" role="status">
        {receipt.text}
      </p>
    </dl>
  );
}

/* ------------------------------------------------------------------ 连接表单 */

/**
 * 这一家的接线：模型名、Key、保存并开始、测试连接、登录、申请 Key、换平台、管理扩展。
 *
 * disabled 一律取反「能不能」的判断；按不下去的原因写在下面一行，不藏着。
 * Key 用不了的真实原因（还没读到配置 / 本机存不住）由 reasons.key 给，不猜。
 */
export function StartConnectForm({ model }: { model: StartModel }): JSX.Element {
  if (!model.available) {
    return <StartConnectionStatus model={model} />;
  }
  if (model.picked === undefined) {
    return (
      <div data-testid="start-connect-empty">
        <Notice tone="neutral" live={false}>
          {model.loading ? '正在读这台机器的模型配置…' : '目录里还没有可接的服务。'}
        </Notice>
      </div>
    );
  }

  const browserSignIn = model.picked.auth === 'browser';

  return (
    <form
      className="sc-form"
      data-testid="start-connect-form"
      data-mark={model.mark ?? 'draft'}
      onSubmit={(event) => {
        event.preventDefault();
        if (browserSignIn) {
          model.signIn();
        } else {
          model.save();
        }
      }}
    >
      <h3 className="sc-form__who">
        <span className="sc-form__name">{model.picked.label}</span>
        <Status
          tone={model.mark === 'in-use' ? 'ok' : model.mark === 'unavailable' ? 'off' : 'warn'}
        >
          {model.mark === null ? '—' : MARK_TEXT[model.mark]}
        </Status>
        <span className="sc-form__region">
          {model.picked.region === 'cn' ? '中国大陆平台' : '国际平台'}
        </span>
      </h3>

      {browserSignIn ? (
        <div className="sc-form__signin">
          <Notice tone="neutral" live={false}>
            这一家用浏览器登录自己的账号，不填 API
            Key。登录完成只是这台机器读到了登录，能不能接上还要看随后那一次写入。
          </Notice>
          <div className="sc-actions">
            <Button
              type="submit"
              variant="primary"
              busy={model.busy.signingIn}
              disabled={!model.can.signIn}
              data-testid="model-signin"
            >
              {model.busy.signingIn ? '正在等登录结果…' : '登录并连接'}
            </Button>
            {model.busy.signingIn ? (
              <Button size="small" data-testid="model-signin-cancel" onClick={model.cancelSignIn}>
                取消这次登录
              </Button>
            ) : null}
          </div>
          {model.signing === null ? null : (
            <p className="sc-wait" role="status" data-testid="model-signin-line">
              {model.signing}
            </p>
          )}
        </div>
      ) : (
        <div className="sc-fields">
          <Field
            className="sc-fields__model"
            label="模型名"
            {...(model.picked.models.length > 0
              ? { hint: '可以直接打，也可以从这家列出的名字里挑。' }
              : {})}
            {...(model.model.trim() === '' ? { error: '模型名不能空着。' } : {})}
          >
            {(control) => (
              <input
                id={control.inputId}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid || undefined}
                className="pb-input"
                value={model.model}
                list="sc-model-list"
                autoComplete="off"
                spellCheck={false}
                data-testid="model-input"
                onChange={(event) => model.setModel(event.target.value)}
              />
            )}
          </Field>
          <datalist id="sc-model-list">
            {model.picked.models.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <Field
            className="sc-fields__key"
            label={model.picked.label + ' 的 API Key'}
            hint={
              model.inUse
                ? '留空就沿用这台机器上已经存着的那一份。'
                : model.keySaved
                  ? '这家在本机存过 Key；填新的会覆盖它。'
                  : model.picked.keyHint
            }
            {...(model.keyBlock === null ? {} : { error: model.keyBlock })}
          >
            {(control) => (
              <input
                id={control.inputId}
                aria-describedby={control.describedBy}
                aria-invalid={model.keyBlock !== null || undefined}
                className="pb-input"
                type="password"
                value={model.key}
                autoComplete="off"
                spellCheck={false}
                disabled={model.keyBlock !== null || model.busy.saving}
                data-testid="key-input"
                onChange={(event) => model.setKey(event.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            busy={model.busy.saving}
            disabled={!model.can.save}
            data-testid="model-save"
          >
            {model.busy.saving ? '正在写入这台机器…' : '保存并开始'}
          </Button>
        </div>
      )}

      <div className="sc-actions">
        <Button
          size="small"
          busy={model.busy.testing}
          disabled={!model.can.test}
          data-testid="model-test"
          onClick={model.test}
        >
          {model.busy.testing ? '正在探测…' : '测试连接'}
        </Button>
        {model.tested === null ? null : (
          <Status tone={model.tested.passed ? 'ok' : 'danger'}>{model.tested.text}</Status>
        )}
        <span className="sc-actions__fill" aria-hidden="true" />
        <Button size="small" variant="quiet" data-testid="model-getkey" onClick={model.openKeyPage}>
          {'去 ' + model.picked.label + ' 申请 Key'}
        </Button>
        {model.sibling === undefined ? null : (
          <Button
            size="small"
            variant="quiet"
            data-testid="model-region"
            onClick={model.switchRegion}
          >
            {model.picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
          </Button>
        )}
        <Button size="small" variant="quiet" data-testid="model-manage" onClick={model.openPlugins}>
          管理模型扩展
        </Button>
      </div>

      {model.can.save || browserSignIn ? null : (
        <p className="sc-hold" data-testid="model-save-reason">
          {model.reasons.save}
        </p>
      )}
      {model.can.test ? null : (
        <p className="sc-hold" data-testid="model-test-reason">
          {model.reasons.test}
        </p>
      )}

      <SaveReceiptBoard model={model} />
    </form>
  );
}

/* ------------------------------------------------------------------ 桌宠这块 */

/**
 * 预览本体由 C 的那一块负责（DOM 是新的，业务参数从这里给）。
 * 这里加的是这一页自己的动作：在桌面显示/隐藏、装扮、暂时不回应。
 */
export function StartPetPanel({ model }: { model: StartModel }): JSX.Element {
  if (!model.appAvailable) {
    return (
      <div data-testid="start-pet">
        <Notice tone="warn" live={false}>
          这一页还没连上应用，所以看不见桌面上是哪一只。
        </Notice>
      </div>
    );
  }
  return (
    <div className="sc-pet" data-testid="start-pet">
      <div className="sc-pet__stage">
        <OriginalPetPreview {...model.pet} />
      </div>
      <div className="sc-pet__rail">
        <Toggle
          label="暂时不回应"
          hint="只是让它先不开口，录音与预览还在这里。"
          pressed={model.paused}
          disabled={model.busy.pausing}
          data-testid="pet-pause"
          onChange={model.togglePaused}
        />
        <div className="sc-actions">
          <Button
            size="small"
            busy={model.busy.visibility}
            disabled={!model.desktopShown}
            data-testid="pet-hide"
            onClick={() => model.setDesktopVisible(false)}
          >
            在桌面隐藏
          </Button>
          <Button
            size="small"
            disabled={model.desktopShown || model.busy.visibility}
            data-testid="pet-show"
            onClick={() => model.setDesktopVisible(true)}
          >
            在桌面显示
          </Button>
          <Button
            size="small"
            variant="primary"
            data-testid="pet-dress"
            onClick={() => model.goToView('appearance')}
          >
            装扮
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 配色这一节：C 的工作室自己读写本机记录，卸载即撤掉没保存的试色。 */
export function StartThemePanel(): JSX.Element {
  return (
    <div className="sc-theme" data-testid="start-theme">
      <OriginalThemeStudio />
    </div>
  );
}

/**
 * 那颗「使用向导」：叫桌宠在桌面上再走一遍，不在设置台里演本地引导，也不自己藏窗口。
 * 它只要应用状态与一句提示，所以不收整页状态——标题行与正文里的入口共用这一份实现。
 */
export function StartGuideAction({
  app,
  notify,
}: {
  app: StartOwners['app'];
  notify: StartOwners['notify'];
}): JSX.Element {
  const [running, setRunning] = useState(false);
  return (
    <Button
      size="small"
      variant="quiet"
      title="由桌宠在桌面上再走一遍"
      disabled={!app.available || app.saving || running}
      busy={running}
      data-testid="start-guide"
      onClick={() => {
        void (async (): Promise<void> => {
          setRunning(true);
          const outcome = await app.startGuide();
          setRunning(false);
          notify(
            outcome.ok ? '引导已经在桌宠那边开始。' : failureLine(outcome.error ?? '未知原因'),
            outcome.ok ? 'ok' : 'danger',
          );
        })();
      }}
    >
      使用向导
    </Button>
  );
}

/**
 * 一次组装出这一屏的插槽：五块新控件，各自接同一份状态。
 * 这里不建第二个持有者，也不把旧组件包一层——插槽里画的就是上面这几个。
 */
export function startSlotsOf(model: StartModel): StartSlots {
  return {
    status: <StartConnectionStatus model={model} />,
    provider: <StartProviderChooser model={model} />,
    connect: <StartConnectForm model={model} />,
    pet: <StartPetPanel model={model} />,
    theme: <StartThemePanel />,
  };
}
