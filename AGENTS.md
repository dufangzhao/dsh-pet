# 开发约定

把整个项目当作一件精简的艺术品：结构清楚，代码可读，表达克制。

## 代码

- 优先最直接、最容易读懂的实现。少一层间接，少一个概念。
- 只解决已确认的需求和真实出现的问题，不为假想场景堆积防护。
- 必要校验集中在边界完成，内部遵循明确契约，不层层重复检查。
- 不随手增加兜底、重试、兼容层、状态、缓存或抽象；先说明它解决什么实际问题。
- 错误处理简短明确，不吞异常，不静默猜测或制造成功。
- 先考虑删除、合并和简化，再考虑新增。注释解释原因，不复述代码。
- 测试关注核心行为和真实回归，避免围绕实现细节堆叠重复用例。

## 文档与交流

- 先给结论，只补必要事实和取舍。
- 不反复免责声明，不层层罗列防御性边界、风险和保留条款。
- 未完成项和重要限制一次说清，不包装、不重复。
- 一处维护、一处引用，避免多份文档重复同一套说明。

每次改动都问：还能删掉什么？还能更清楚吗？
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
