/**
 * 上游原件按字节读进来的那一种导入（Vite 的 ?raw）。
 *
 * 存在的理由只有一条：对照板上要说的是「网站上那一份原样」，所以不能由我们重新打一遍字。
 * 只声明 ?raw 这一种，不声明任何远端资源。
 */
declare module '*.html?raw' {
  const source: string;
  export default source;
}
