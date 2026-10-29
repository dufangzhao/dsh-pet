/**
 * 厂商标记：品牌 SVG 由 assets 那边的 manifest.json 指到文件名，这里只把文件名换成打包后的地址。
 *
 * Vite 只认字面量的 new URL，所以一格一格列出来，不做目录扫描；
 * manifest 里没有这家服务就不画标记，芯片上仍然有名字，含义不靠图形撑着。
 */
import manifest from './vendor-icons/manifest.json' with { type: 'json' };

const files: Readonly<Record<string, URL>> = {
  'deepseek-color.svg': new URL('./vendor-icons/deepseek-color.svg', import.meta.url),
  'qwen-color.svg': new URL('./vendor-icons/qwen-color.svg', import.meta.url),
  'kimi-color.svg': new URL('./vendor-icons/kimi-color.svg', import.meta.url),
  'chatglm-color.svg': new URL('./vendor-icons/chatglm-color.svg', import.meta.url),
  'doubao-color.svg': new URL('./vendor-icons/doubao-color.svg', import.meta.url),
  'minimax-color.svg': new URL('./vendor-icons/minimax-color.svg', import.meta.url),
  'stepfun-color.svg': new URL('./vendor-icons/stepfun-color.svg', import.meta.url),
  'baiducloud-color.svg': new URL('./vendor-icons/baiducloud-color.svg', import.meta.url),
  'openrouter.svg': new URL('./vendor-icons/openrouter.svg', import.meta.url),
  'openai.svg': new URL('./vendor-icons/openai.svg', import.meta.url),
  'anthropic.svg': new URL('./vendor-icons/anthropic.svg', import.meta.url),
  'gemini-color.svg': new URL('./vendor-icons/gemini-color.svg', import.meta.url),
  'xai.svg': new URL('./vendor-icons/xai.svg', import.meta.url),
};

const byService: Record<string, string> = manifest.services;

/** 这家服务的标记地址；没有就 null，页面自己决定留不留空位。 */
export function vendorIcon(service: string): string | null {
  const file = byService[service];
  if (file === undefined) {
    return null;
  }
  const url = files[file];
  return url === undefined ? null : url.href;
}
