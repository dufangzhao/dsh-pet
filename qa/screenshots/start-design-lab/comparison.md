# 五个开始栏设计方案

[打开全部浅色对照](start-lab-1793272859631-b3d0f795/overview-light.png)。均为同一次已通过验收的真实Electron窗口，1200×800、DPR1、zoom100%；它们使用同一套已连接动作。普通入口仍是基准，评审入口初始展示bench供比较，不代表已选生产版。

| 方案 | 布局与交互取舍 | 浅色 | 深色 |880×600 |
| --- | --- | --- | --- | --- |
| 并肩工作台 | 桌宠左侧、连接检查器右侧；同时总览，窄窗堆叠 | [图](start-lab-1793272859631-b3d0f795/bench-light-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/bench-dark-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/bench-minimum-880x600.png) |
| 模型接线台 | 厂商目录与详情主从布局；频繁换服务更直接，桌宠位置较后 | [图](start-lab-1793272859631-b3d0f795/switchboard-light-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/switchboard-dark-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/switchboard-minimum-880x600.png) |
| 从连接到见面 | 三段可回开的顺序；初用更聚焦，重复调整多一次展开 | [图](start-lab-1793272859631-b3d0f795/spine-light-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/spine-dark-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/spine-minimum-880x600.png) |
| 桌宠在场 | 大舞台优先，连接与配色放下方托盘；陪伴感更强，接线需展开 | [图](start-lab-1793272859631-b3d0f795/stage-light-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/stage-dark-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/stage-minimum-880x600.png) |
| 三页工作簿 | 三个本地工作页各占全宽；窄窗最清晰，总览较少 | [图](start-lab-1793272859631-b3d0f795/workspaces-light-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/workspaces-dark-1200x800.png) | [图](start-lab-1793272859631-b3d0f795/workspaces-minimum-880x600.png) |

[当前构建基准页](../coopanion-start/coop-start-1793272804867-49bf2eb9/light-1200x800.png) · [五版原生验收](start-lab-1793272859631-b3d0f795/acceptance-report.json) · [基准回归](../coopanion-start/coop-start-1793272804867-49bf2eb9/acceptance-report.json)

双击根目录[Start-Design-Lab.cmd](../../../Start-Design-Lab.cmd)可切换实用；它使用独立评审资料，正常启动资料不变。所有变体共用模型/录音/会话/历史/配色所有者。新组件使用Morphicons2.0.2和自有图形数据；Uiverse的三条MIT组件作为独立改写的可供性参考，完整来源/许可见[NOTICE](../../../THIRD_PARTY_NOTICES.md)。

前端由3个Qoder CN DeepSeek max工作者实现，UI Designer实际报告1份，另外2份咨询未成功，不冒称共识。真人账号/付费服务在线可用性未在此布局验收中测试；历史行为基线、来源与完整检查统一见[QA状态](../../plugin-application-status.md)。

流程已形成[replicate-then-redesign技能](../../../.agents/skills/replicate-then-redesign/SKILL.md)，[独立前向测试](../../replica-redesign-skill-results.md)在另一个气泡表面执行计划验证，没有改动气泡产品实现。
