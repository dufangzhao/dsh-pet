/**
 * 人格与当前记忆的 UI-only 入口，供 web 与设置台共用。
 *
 * 只导出受控组件、它的 transport 结构与纯规则类型；不导出任何 HTTP/Main 实现，
 * 也不复制 DTO —— 类型全部来自 @pet/contracts。
 * 样式需显式 import '@pet/text-client/persona-memory.css'；桌宠窗口不 import。
 */
export { PersonaMemory, hasPersonaMemory } from './client/persona-memory.js';
export type { PersonaMemoryProps, PersonaMemoryTransport } from './client/persona-memory.js';
export {
  applicationLabel,
  availability,
  emptyPersonaMemoryForm,
  originLabel,
} from './client/memory-form.js';
export type {
  Availability,
  PersonaMemoryBusy,
  PersonaMemoryForm,
  PersonaMemoryNotice,
} from './client/memory-form.js';
