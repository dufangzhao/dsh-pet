/**
 * 设置台入口：只挂载 React 根，不注册 IPC、不读系统信息。
 * 主题偏好在任何绘制之前写到 <html data-theme>，避免先闪一帧错误的配色。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ConsoleApp } from './console-app.js';
import { applyStoredTheme } from './theme.js';
import './console.css';

applyStoredTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
