/**
 * 一条消息的正文与材料。
 *
 * 三种情况必须分开说：
 * - `inline-text`：`message.text` 就是完整正文，直接显示。
 * - `text-document`：`message.text` 只是**说明**，真正的正文在材料里；
 *   所以这里给「查看全文」，绝不把说明当正文。
 * - 其它材料：给出明确的下载入口，不在页面里假装能预览。
 *
 * 全文与下载都按**渲染时捕获的** connectionId + material id 锁定：
 * 换连接之后旧结果不落地，也不会把 A 的材料显示成 B 的。
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { Button } from '@pet/ui-kit';
import type { CompanionMaterialRef, CompanionMessage } from '@pet/contracts';

import {
  MATERIAL_TEXT_MAX_BYTES,
  readMaterialBlob,
  readMaterialText,
  saveBlob,
} from './material-transport.js';

export interface MaterialActions {
  /** 这次渲染所属的连接世代；变化后旧结果作废。 */
  readonly connectionId: string;
  readonly readText: (
    materialId: string,
  ) => Promise<{ ok: boolean; value?: string; error?: unknown }>;
  readonly readBlob: (
    materialId: string,
  ) => Promise<{ ok: boolean; value?: { blob: Blob; filename: string | null }; error?: unknown }>;
}

/**
 * SILK 是 QQ 的语音格式，浏览器不能直接播。
 * 所以它只能下载——不要给一个点了没反应的播放器。
 */
function downloadOnlyHint(ref: CompanionMaterialRef): string | null {
  if (ref.kind === 'voice') return '语音是 SILK 格式，浏览器不能直接播放；可以下载。';
  return null;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface MessageMaterialsProps {
  readonly message: CompanionMessage;
  readonly actions: MaterialActions;
}

export function MessageMaterials({ message, actions }: MessageMaterialsProps): JSX.Element | null {
  const [open, setOpen] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * 当前生效的连接身份。
   *
   * 必须放在 ref 里：直接和同一个闭包里的 `actions.connectionId` 比是**永相等**的
   * 假比较——闭包捕获的是发起那一刻的值，它不会自己变。ref 才在每次渲染时更新，
   * await 之后读到的才是「此刻真正生效的连接」。
   */
  const currentOwner = useRef(actions.connectionId);
  currentOwner.current = actions.connectionId;
  /** 卸载之后任何结果都不许落地：下载是有副作用的动作，不能靠重挂来阻止。 */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * owner 切换时把**整个操作域**作废。
   *
   * 只加一个「结果落地前再比一次」是不够的：A 的读取还挂着时切到 B，
   * 旧操作留下的 busy / 已打开的全文 / 失败提示会留在 B 上——按钮永远禁用、
   * 内容还是 A 的。所以这里在 owner 变化时同步清掉这一域的全部本地状态。
   */
  const ownerRef = useRef(actions.connectionId);
  useEffect(() => {
    if (ownerRef.current === actions.connectionId) return;
    ownerRef.current = actions.connectionId;
    setBusy(null);
    setOpen(null);
    setFailure(null);
  }, [actions.connectionId]);

  /** 这次操作是否仍属于当前连接。 */
  const stillOurs = (owner: string): boolean => alive.current && currentOwner.current === owner;

  const documentRef = message.content?.kind === 'text-document' ? message.content.material : null;
  const attachments = (message.materials ?? []).filter(
    (ref) => documentRef === null || ref.id !== documentRef.id,
  );

  if (documentRef === null && attachments.length === 0) return null;

  const showFull = async (ref: CompanionMaterialRef): Promise<void> => {
    const owner = currentOwner.current;
    setBusy(ref.id);
    setFailure(null);
    const result = await actions.readText(ref.id);
    // 派发后与 await 后都查一次：换连接或卸载，旧结果都不落地。
    if (!stillOurs(owner)) return;
    setBusy(null);
    if (!result.ok || typeof result.value !== 'string') {
      setFailure('没能读到全文。可以试试下载。');
      return;
    }
    setOpen({ id: ref.id, text: result.value });
  };

  const download = async (ref: CompanionMaterialRef): Promise<void> => {
    const owner = currentOwner.current;
    setBusy(ref.id);
    setFailure(null);
    const result = await actions.readBlob(ref.id);
    // 下载有副作用：换连接或卸载之后绝不能再触发保存。
    if (!stillOurs(owner)) return;
    setBusy(null);
    if (!result.ok || result.value === undefined) {
      setFailure('没能下载这个材料。');
      return;
    }
    saveBlob(result.value.blob, result.value.filename ?? ref.name);
  };

  return (
    <div className="tc-msg__materials" data-testid="message-materials">
      {documentRef === null ? null : (
        <div className="tc-msg__material" data-testid="material-document">
          <span className="tc-msg__material-name">
            全文 · {documentRef.name} · {sizeLabel(documentRef.sizeBytes)}
          </span>
          {documentRef.sizeBytes > MATERIAL_TEXT_MAX_BYTES ? (
            // 超过上限就说清楚：不能把「读不下」显示成一段截断的正文。
            <span className="tc-msg__material-note">
              超过 {Math.round(MATERIAL_TEXT_MAX_BYTES / 1024)} KB，请下载后查看。
            </span>
          ) : (
            <Button
              size="small"
              disabled={busy !== null}
              data-testid={`material-view-${documentRef.id}`}
              onClick={() => void showFull(documentRef)}
            >
              查看全文
            </Button>
          )}
          <Button
            size="small"
            variant="quiet"
            disabled={busy !== null}
            data-testid={`material-download-${documentRef.id}`}
            onClick={() => void download(documentRef)}
          >
            下载
          </Button>
        </div>
      )}

      {attachments.map((ref) => (
        <div className="tc-msg__material" key={ref.id} data-testid={`material-${ref.id}`}>
          <span className="tc-msg__material-name">
            {ref.name} · {ref.mediaType} · {sizeLabel(ref.sizeBytes)}
          </span>
          {downloadOnlyHint(ref) === null ? null : (
            <span className="tc-msg__material-note">{downloadOnlyHint(ref)}</span>
          )}
          <Button
            size="small"
            variant="quiet"
            disabled={busy !== null}
            data-testid={`material-download-${ref.id}`}
            onClick={() => void download(ref)}
          >
            下载
          </Button>
        </div>
      ))}

      {open === null ? null : (
        <div className="tc-msg__fulltext" data-testid="material-fulltext">
          <pre className="tc-msg__fulltext-body">{open.text}</pre>
          <Button size="small" variant="quiet" onClick={() => setOpen(null)}>
            收起
          </Button>
        </div>
      )}

      {failure === null ? null : (
        <p className="tc-msg__material-note" role="alert" data-testid="material-failure">
          {failure}
        </p>
      )}
    </div>
  );
}

/** 默认动作：走真实的材料读取。 */
export function materialActions(
  connectionId: string,
  transport: { readonly baseUrl: string; readonly token: string },
): MaterialActions {
  return {
    connectionId,
    readText: (materialId) => readMaterialText(transport, materialId),
    readBlob: (materialId) => readMaterialBlob(transport, materialId),
  };
}
