/**
 * 对照板左边那一格：把 vendored 的上游原件按字节摆出来。
 *
 * 三件事凑成一处：
 *   · 上游那一段 HTML 连自己那段 <style> 一起进一个 shadow root，于是原件的 .button /
 *     .input / .switch 这些全局名漏不到设置台，设置台的类名也进不去改它的样子；
 *   · 宿主那一格负责给够画布与居中（原件里有几枚自带位移，边距小了会被裁），不改上游一个字节；
 *   · CSP 是 default-src 'none' 与 frame-src 'none'，所以这里不用 iframe，影子边界就是那道隔离。
 *     但影子只隔 CSS、不隔原生表单：Forms 那一件自带 <form>，宿主在这一格拦一次 submit，
 *     上游字节一个都不动。外链走 target="_blank"，主窗口的 will-navigate 本来就被主进程挡住，
 *     点来源链接不会把这一屏换走。
 */
import './raw-example.css';

import { useEffect, useRef, type JSX } from 'react';

import { RAW_SOURCES, type RawSourceSlug } from './raw-source.js';

export interface RawSourceExampleProps {
  slug: RawSourceSlug;
  /** 这一格上面那一句字（默认用上游这一件的名称）。 */
  label?: string;
}

/** 上游字节原样，只在这一格里可见。 */
export function RawSourceExample({ slug, label }: RawSourceExampleProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const source = RAW_SOURCES[slug].source;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = source;
    const stopSubmit = (event: Event): void => event.preventDefault();
    shadow.addEventListener('submit', stopSubmit);
    return () => {
      shadow.removeEventListener('submit', stopSubmit);
      shadow.innerHTML = '';
    };
  }, [source]);

  return (
    <div className="su-rawcell">
      <p className="su-rawcell__caption">{label ?? RAW_SOURCES[slug].slug}</p>
      <div
        className="su-rawcell__stage"
        ref={hostRef}
        data-slug={slug}
        data-testid={'raw-' + slug}
      />
      <p className="su-rawcell__foot">
        <a
          className="su-rawcell__link"
          href={RAW_SOURCES[slug].permalink}
          target="_blank"
          rel="noreferrer"
        >
          {RAW_SOURCES[slug].author + ' / ' + slug}
        </a>
        <span className="su-rawcell__hash">
          {'sha256 ' + RAW_SOURCES[slug].sha256.slice(0, 12)}
        </span>
      </p>
    </div>
  );
}
