# 网站风格预览

直接打开 [index.html](index.html)，或双击项目根目录的 [Preview-Website-Styles.cmd](../../Preview-Website-Styles.cmd)。这是外观比较页：使用示例内容和浏览器本地控件状态，不连接软件业务，不保存真实配置，也不替换当前产品风格。

| 方案             | 实际基础                                                                                    | 主要特征                                         |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 墨线硬边（当前） | [andrew-demchenk0](https://uiverse.io/andrew-demchenk0/afraid-squid-51)相关控件             | 实体描边、偏移硬投影、按压位移、胶囊开关         |
| 柔软浮雕         | [sameer2malik / lucky-insect-98](https://uiverse.io/sameer2malik/lucky-insect-98)           | 浅灰一体底、内凹胶囊输入、外凸柔影按钮           |
| 全息玻璃         | [KhelVers / honest-lionfish-67](https://uiverse.io/KhelVers/honest-lionfish-67)             | 青色透明面、白色描边、内发光、渐变按钮与投影装饰 |
| 星空霓虹         | [John-CFO / spicy-horse-10](https://uiverse.io/John-CFO/spicy-horse-10)                     | 暗色星空、白色直角边界、等宽输入、按钮扫光       |
| 紫色下划线       | [vinodjangid07 / horrible-warthog-14](https://uiverse.io/vinodjangid07/horrible-warthog-14) | 白卡、斜紫圆角块、下划线输入、扁平紫色动作       |

新增四组各取一个现成复合表单，它本身已经包含面板、输入和按钮，避免把无关组件凑成一套。原样视图保留源代码；整窗示意按其材料规则替换中文样例与尺寸。预览布局不是网站发布的完整设计系统，登录等原表单业务未移植。

[五组实际预览对比图](screenshots/five-style-overview.png) · [原件四组对比](screenshots/source-four-overview.png) · [浏览器检查记录](screenshots/visual-report.json)

实际Chrome检查已通过五组切换、组合/控件/原件视图、宽窄画布、输入不重叠、当前组材质生效及9份原件SHA-256；留下20张预览截图，0页面异常、0远端资源请求。生产应用代码未修改。

完整作者、角色、SHA-256、原始文件和MIT许可在 [source-manifest.json](source-manifest.json)与[sources](sources/)。原代码来自Uiverse官方Galaxy固定提交`adbd2adde0a299a3956ea288fb444ec01891ca41`。网站当前普通访问返回Cloudflare提示，预览不绕过访问控制。图标沿用Morphicons支持的Tabler outline资源，来源及许可同样列在清单中。
