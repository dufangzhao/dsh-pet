import { randomUUID } from 'node:crypto';

const DEMO_CODE =
  "import { writeFileSync } from 'node:fs'; writeFileSync('result.txt', 'Companion demo completed.\\n'); console.log('Created result.txt');";
const label = '离线脚本演示：';
const taskLabels = {
  accepted: '已受理',
  running: '运行中',
  'cancel-requested': '已请求停止',
  completed: '已完成',
  cancelled: '已停止',
  failed: '执行失败',
  interrupted: '执行已中断',
  unknown: '结果待核对',
};

function receiptText(name, output, tasks) {
  if (name === 'list_work') return summarizeTasks(tasks);
  let receipt;
  try {
    receipt = JSON.parse(output);
  } catch {
    return '本次操作未能确认，请查看任务状态。';
  }
  const actual = receipt?.receipt ?? receipt;
  if (!actual || !['accepted', 'duplicate'].includes(actual.status))
    return '本次操作未能确认，请查看任务状态。';
  if (name === 'start_work') return '任务已受理。可以继续交谈，也可以在任务区查看进度或停止它。';
  if (name === 'stop_work') return '已发送停止请求，最终状态以任务区为准。';
  if (name === 'remember')
    return receipt.applicationError
      ? '偏好已保存，但当前上下文未应用。'
      : actual.status === 'duplicate'
        ? '这次记住请求此前已受理，当前内容以记忆区为准。'
        : '偏好已保存。';
  return '操作已受理。';
}

function summarizeTasks(tasks, includeIds = false) {
  return (
    tasks
      .slice(-12)
      .map(
        (task) =>
          `${includeIds ? `${task.id} · ` : ''}${task.title} · ${taskLabels[task.status] ?? '状态待核对'}`,
      )
      .join('\n') || '暂无任务。'
  );
}

export function createScriptedClient(native, scope) {
  const stages = new Map();
  return {
    reset() {
      stages.clear();
    },
    async respond(request) {
      const current = scope();
      const output = [];
      const invoke = (name, args) => {
        const callId = randomUUID();
        output.push({
          type: 'function_call',
          id: `item-${callId}`,
          call_id: callId,
          name,
          arguments: JSON.stringify(args),
          status: 'completed',
        });
        return callId;
      };
      for (const input of current.inputs) {
        const stage = stages.get(input.id);
        if (stage?.done) continue;
        if (stage) {
          const receipt = request.input.find(
            (item) => item.type === 'function_call_output' && item.call_id === stage.callId,
          );
          if (!receipt) continue;
          const result =
            typeof receipt.output === 'string' ? receipt.output : JSON.stringify(receipt.output);
          invoke('say', {
            inputId: input.id,
            text: `${label}${receiptText(stage.name, result, current.context.tasks)}`,
          });
          stages.set(input.id, { done: true });
          continue;
        }
        const text = input.text.trim();
        let name;
        let args;
        const preference =
          /^(?:remember|记住)\s*([^=：:]{1,80})\s*[=：:]\s*([\s\S]{1,1000})$/iu.exec(text);
        const freePreference = /^记住\s*([\s\S]{1,1000})$/u.exec(text);
        if (input.kind === 'work-result') {
          const task = current.context.tasks.find((item) => item.id === input.taskId);
          const summary = task
            ? `${task.title}：${taskLabels[task.status] ?? '状态待核对'}。${task.artifacts.length ? '产物可在任务区下载。' : ''}`
            : '后台任务有新的结果，可在任务区查看。';
          invoke('say', { inputId: input.id, text: `${label}${summary}` });
        } else if (preference || freePreference) {
          name = 'remember';
          args = {
            inputId: input.id,
            key: preference?.[1]?.trim() ?? 'explicit-preference',
            value: preference?.[2]?.trim() ?? freePreference[1],
          };
        } else if (
          /文件任务|(?:写|生成|创建).*文件|(?:start|run).*\b(?:demo|file)\b/iu.test(text)
        ) {
          name = 'start_work';
          args = {
            inputId: input.id,
            title: 'Scripted file demonstration',
            code: DEMO_CODE,
            outputs: [{ path: 'result.txt', mediaType: 'text/plain' }],
          };
        } else if (/^(?:stop|cancel|停止|取消)(?:\s|任务)/iu.test(text)) {
          const explicitId = /^(?:stop|cancel|停止|取消)(?:\s*任务)?\s+([A-Za-z0-9._:-]+)$/iu.exec(
            text,
          )?.[1];
          const target =
            explicitId ??
            current.context.tasks
              .slice()
              .reverse()
              .find((task) => ['accepted', 'running', 'cancel-requested'].includes(task.status))
              ?.id;
          if (target) {
            name = 'stop_work';
            args = { inputId: input.id, taskId: target };
          } else {
            invoke('say', { inputId: input.id, text: `${label}没有找到可停止的任务。` });
          }
        } else if (/任务|\b(?:tasks|work|status)\b/iu.test(text)) {
          name = 'list_work';
          args = {};
        } else if (/偏好|记住|\b(?:preference|remember)\b/iu.test(text)) {
          const facts = current.context.facts
            .map((fact) => `${fact.key}: ${fact.value}`)
            .join('\n');
          invoke('say', {
            inputId: input.id,
            text: `${label}${facts || '还没有保存的显式偏好。'}`.slice(0, 7900),
          });
        } else {
          invoke('say', {
            inputId: input.id,
            text: `${label}已收到「${text.slice(0, 1500)}」。可试试“记住 语言: 中文”、“创建文件任务”或“查看任务”。`,
          });
        }
        if (name) {
          stages.set(input.id, { callId: invoke(name, args), name });
        } else {
          stages.set(input.id, { done: true });
        }
      }
      const response = {
        ...native.createResponse(randomUUID(), request),
        status: 'completed',
        completed_at: Math.floor(Date.now() / 1000),
        output,
      };
      const origin = {
        instance: 'companion-scripted',
        module: 'openai-responses-compat',
        model: 'offline-scripted',
        compatibilityDomain: 'offline-scripted',
      };
      return {
        response,
        origin,
        attempts: [
          {
            id: randomUUID(),
            generationId: response.id,
            ordinal: 1,
            origin,
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            requestId: null,
            responseId: response.id,
            outcome: 'completed',
            status: null,
            serviceTier: null,
            meters: native.unknownMeters(),
            charges: [],
          },
        ],
      };
    },
  };
}

export function workSummary(tasks) {
  return summarizeTasks(tasks, true);
}
