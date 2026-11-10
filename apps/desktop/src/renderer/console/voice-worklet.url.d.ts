/**
 * 中性 worklet 的脚本地址声明。
 *
 * 桌面用 Vite 的 `?worker&url` 把 `@pet/audio-capture/capture-worklet` 编成一份
 * 同源脚本，产出的 URL 与主脚本同目录——应用 CSP 的 `script-src 'self'` 只认它。
 * 纯 `?url` 会把源码内联成 data: URL，worklet 既拿不到 JS 也不是 'self'。
 */
declare module '@pet/audio-capture/capture-worklet?worker&url' {
  const workletUrl: string;
  export default workletUrl;
}
