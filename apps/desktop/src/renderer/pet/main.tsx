/**
 * 渲染器入口：只挂载 React 根，不注册 IPC、不读系统信息。
 * CSP 由 index.html 的 meta 限定为本地资源且 connect-src 'none'。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PetApp } from './App.js';
import './pet.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <PetApp />
  </StrictMode>,
);
