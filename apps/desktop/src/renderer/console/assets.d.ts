/**
 * 渲染器的本地样式副作用导入声明。Vite 在构建时处理 .css，tsc 需要这行才能接受 import。
 * 只声明样式，不声明任何远端资源或图片加载能力。
 */
declare module '*.css';
