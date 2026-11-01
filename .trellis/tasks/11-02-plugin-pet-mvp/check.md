# 验证记录

完整工作区pnpm check通过：类型、全部工作区测试、121项QA（120通过、1项既有跳过）、ESLint、Prettier及原生构建。最终原生报告与截图见[验收证据](../../../qa/plugin-pet-mvp/README.md)。

原生覆盖公开WAV→唯一采集→SenseVoice→统一Core记录→真实System.Speech PCM→实际WebAudio回执；输入监听超过32秒仍活跃，停用语音模块撤回其设置页，主题/声音关闭及重启保留通过。

正常既有配置从旧schema1/revision34通过已声明migrator与ConfigService CAS迁至schema2/revision35，56项偏好可读，Core与页面就绪。只投影正常配置状态，不读取或记录密钥。

架构专家局部审查确认的P1刷新/停止反馈循环已修复；原生关闭声音仅产生2次通知。审查覆盖有限，不视为整体批准。

验收回复明确使用离线脚本模式，没有付费模型请求。SenseVoice及WindowsSAPI真实识别通过，Whisper未下载、云ASR仅隔离请求夹具；真实物理麦克风和云服务连接未作为自动验收结论。高级角色行为和完整装扮包后续状态统一维护在实现指南。
