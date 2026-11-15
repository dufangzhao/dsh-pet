import { useState, type FormEvent, type JSX } from 'react';

interface ConnectFormProps {
  readonly pending: boolean;
  /** 上次连接失败的原因；连接成功后由外层清掉。 */
  readonly error: string | null;
  /** 服务端协议版本与本地不一致时给出具体数字。 */
  readonly protocolMismatch: number | null;
  readonly onConnect: (token: string) => void;
}

/**
 * 连接入口。token 只在这一屏的受控输入里存在，提交后交给内存中的客户端，
 * 不写 localStorage、不拼进 URL，也不回显。
 */
export function ConnectForm({
  pending,
  error,
  protocolMismatch,
  onConnect,
}: ConnectFormProps): JSX.Element {
  const [token, setToken] = useState('');
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (value === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    setToken('');
    onConnect(value);
  };

  return (
    <main className="tc-gate">
      <div className="tc-gate__inner">
        <h1 className="tc-gate__title">文字入口</h1>
        <p className="tc-gate__lead">同一个助手，继续之前的对话与任务。</p>
        <form className="tc-gate__form" onSubmit={submit}>
          <label className="tc-gate__label" htmlFor="tc-token">
            访问令牌
          </label>
          <input
            id="tc-token"
            className="tc-gate__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            disabled={pending}
            onChange={(event) => setToken(event.target.value)}
            aria-describedby="tc-token-hint"
            aria-invalid={missing || error !== null ? 'true' : undefined}
          />
          <p className="tc-gate__hint" id="tc-token-hint">
            只保存在本页内存中，刷新后需要重新输入。
          </p>
          {missing ? (
            <p className="tc-gate__error" role="alert">
              请填入访问令牌。
            </p>
          ) : null}
          {error === null ? null : (
            <p className="tc-gate__error" role="alert">
              {error}
              {protocolMismatch === null
                ? null
                : ` 服务端协议版本为 ${protocolMismatch}，本页面只支持 1，需要更新其中一侧。`}
            </p>
          )}
          <button type="submit" className="tc-send" disabled={pending}>
            {pending ? '正在连接…' : '连接'}
          </button>
        </form>
      </div>
    </main>
  );
}
