# M0-05 · 说话键验证记录

状态：**逻辑/原生轮询台架通过，真实按压未覆盖，不能宣称不漏键**。Node24.22.0 / Electron45.0.0 / Koffi3.3.1；硬件见[M0基线](M0-00-environment.md)。

## 已验证

[状态机](../packages/host-kernel/src/experiments/talk-key-probe.ts)和[12项测试](../packages/host-kernel/src/experiments/talk-key-probe.test.ts)：首次按下立即start，不等待长按阈值；250ms及以上松开finish；短于250ms进入持续模式，下次按下立即finish并等待松开；重复down不重复start，不重置计时；取消后排空旧释放；非法/逆序时间戳拒绝且不污染状态。250ms只是初值，不是手感实验结论。

真实Electron主进程fork Node模式worker，只读F24高位，不读取其它键、不注入任何输入。每周期测4秒；observedF24Transitions均0，明确没有真实按压样本。时钟为performance.now，CPU为process.cpuUsage差值；CPU百分比是单核等效，不能当作整机占用率。

| 设定周期 | 调用数 | 间隔p50 | 间隔p95 | 最大间隔 | CPU时间 | 单核等效CPU |
| --- | --- | --- | --- | --- | --- | --- |
| 30ms | 121 | 31.201ms | 44.924ms | 51.339ms | 46ms | 1.146% |
| 10ms | 257 | 15.557ms | 16.415ms | 16.628ms | 63ms | 1.572% |

原始结构化结果见[记录](V-key-results.json)，实现见[轮询探针](probes/key-worker.cjs)。后台开发负载未冻结，测量很短且30ms组先运行，不外推长期功耗或高负载保证；没有修改Windows定时器分辨率或电源配置。

## 合成脉冲回放，不是物理按压成功率

把固定宽度的合成按下区间沿真实采样时间轴每1ms移动，判断是否有采样落在区间内；边缘100ms剔除。

| 设定周期 | 20ms脉冲漏采 | 50ms脉冲漏采 | 100ms脉冲漏采 |
| --- | --- | --- | --- |
| 30ms | 1500/3780 | 2/3750 | 0/3700 |
| 10ms | 0/3772 | 0/3742 | 0/3692 |

这暴露了30ms轮询在本次调度下的风险，不是系统键盘实测；10ms也会漏掉一些5/10ms合成脉冲，不能保证任意短按。

## 暂定建议与选项

- 下一阶段先用 **10ms请求周期 + 250ms长按阈值**；实际周期仍取决于Windows调度，可凭后续证据调整。F24只是本次安静测量键，不选为产品默认热键。
- 若真实按压验收仍漏键，评估专用按键进程/原生事件监听或键盘钩子；更复杂且需独立权限、清理、冲突及许可评估，不自动替换当前方案。
- 没有前台控制授权，未进行OS事件注入。仍需受控真实按压/真人快速轻点、组合键冲突、失焦/锁屏/休眠与长时负载测试。M3-02的“不漏检”验收不能用本报告替代。

## 复现

```sh
pnpm --filter @pet/host-kernel typecheck
pnpm --filter @pet/host-kernel test
pnpm exec esbuild packages/host-kernel/src/experiments/talk-key-probe.ts --bundle --platform=node --format=esm --outfile=packages/host-kernel/dist/m0/talk-key-probe.mjs
pnpm exec electron qa/probes/worker-main.cjs key
```

Electron主进程启动前清除ELECTRON_RUN_AS_NODE、ELECTRON_OVERRIDE_DIST_PATH；本机已如此执行。此为M0实验，不是已实现的录音/说话键插件。
