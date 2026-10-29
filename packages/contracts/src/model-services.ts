import type { ModelService } from './model-connection.js';
export interface ModelServiceEndpoint extends ModelService {
  readonly baseUrl: string;
  readonly protocol: 'chat' | 'responses' | 'anthropic' | 'gemini' | 'browser';
  readonly secretKey: string;
}
type Endpoint = [
  id: string,
  label: string,
  baseUrl: string,
  model: string,
  protocol: ModelServiceEndpoint['protocol'],
  keyUrl: string,
  models?: string[],
];
// Endpoint and model facts are fixed so a UI value cannot become an arbitrary network target.
const entries: Endpoint[] = [
  [
    'deepseek',
    'DeepSeek',
    'https://api.deepseek.com',
    'deepseek-flash',
    'responses',
    'https://platform.deepseek.com/api_keys',
    ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  ],
  [
    'qwen',
    '通义千问',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'qwen3.8-flash',
    'responses',
    'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    ['qwen3.7-flash', 'qwen3.8-max'],
  ],
  [
    'qwen-intl',
    '通义千问',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'qwen3.8-flash',
    'responses',
    'https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/settings/api-key',
    ['qwen3.7-flash', 'qwen3.8-max'],
  ],
  [
    'kimi',
    'Kimi',
    'https://api.moonshot.cn/v1',
    'kimi-k3',
    'responses',
    'https://platform.kimi.com/console/api-keys',
  ],
  [
    'kimi-intl',
    'Kimi',
    'https://api.moonshot.ai/v1',
    'kimi-k3',
    'responses',
    'https://platform.kimi.ai/console/api-keys',
  ],
  [
    'glm',
    '智谱 GLM',
    'https://open.bigmodel.cn/api/v1',
    'glm-5.3-flash',
    'responses',
    'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    ['glm-5.3', 'glm-4.6v-flashx', 'glm-4.6v-flash'],
  ],
  [
    'glm-intl',
    '智谱 GLM',
    'https://api.z.ai/api/paas/v4',
    'glm-5.3-flash',
    'chat',
    'https://z.ai/manage-apikey/apikey-list',
    ['glm-5.3', 'glm-4.6v-flash'],
  ],
  [
    'doubao',
    '豆包',
    'https://ark.cn-beijing.volces.com/api/v3',
    'doubao-seed-2-1-lite-260915',
    'responses',
    'https://ark.volcengine.com/region:cn-beijing/apikey',
    ['doubao-seed-2-0-mini-260428'],
  ],
  [
    'minimax',
    'MiniMax',
    'https://api.minimax.cn/v1',
    'MiniMax-M3',
    'responses',
    'https://platform.minimax.cn/user-center/basic-information/interface-key',
    ['MiniMax-M2.7'],
  ],
  [
    'minimax-intl',
    'MiniMax',
    'https://api.minimax.io/v1',
    'MiniMax-M3',
    'responses',
    'https://platform.minimax.io/user-center/basic-information/interface-key',
    ['MiniMax-M2.7'],
  ],
  [
    'stepfun',
    '阶跃星辰',
    'https://api.stepfun.com/v1',
    'step-3.7-flash',
    'responses',
    'https://platform.stepfun.com/interface-key',
    ['step-5-preview'],
  ],
  [
    'stepfun-plan',
    '阶跃 Step Plan',
    'https://api.stepfun.com/step_plan/v1',
    'step-5-preview',
    'chat',
    'https://platform.stepfun.com/interface-key',
    ['step-3.7-flash'],
  ],
  [
    'qianfan',
    '百度千帆',
    'https://qianfan.baidubce.com/v2',
    'glm-5.3-flash',
    'chat',
    'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    ['deepseek-v4.1-flash', 'ernie-4.5-turbo-vl', 'glm-5.1'],
  ],
  [
    'openrouter',
    'OpenRouter',
    'https://openrouter.ai/api/v1',
    'deepseek/deepseek-v4.1-flash',
    'responses',
    'https://openrouter.ai/settings/keys',
    [
      'qwen/qwen3.8-flash',
      'qwen/qwen3.7-flash',
      'google/gemini-3.1-flash-lite',
      'z-ai/glm-5.3-flash',
    ],
  ],
  [
    'openai',
    'OpenAI',
    'https://api.openai.com/v1',
    'gpt-6-luna',
    'responses',
    'https://platform.openai.com/settings/organization/api-keys',
    ['gpt-6.1-sol', 'gpt-6-astra'],
  ],
  [
    'chatgpt',
    'ChatGPT',
    'https://api.openai.com/v1',
    'gpt-6-luna',
    'browser',
    'https://chatgpt.com/',
  ],
  [
    'anthropic',
    'Anthropic',
    'https://api.anthropic.com',
    'claude-haiku-5-5',
    'anthropic',
    'https://platform.claude.com/settings/keys',
    ['claude-sonnet-5-5', 'claude-opus-5-5'],
  ],
  [
    'gemini',
    'Gemini',
    'https://generativelanguage.googleapis.com/v1beta',
    'gemini-3.5-flash-lite',
    'gemini',
    'https://aistudio.google.com/apikey',
    ['gemini-3.8-flash', 'gemini-3.1-pro-preview'],
  ],
  [
    'xai',
    'xAI',
    'https://api.x.ai/v1',
    'grok-4.3',
    'responses',
    'https://console.x.ai/team/default/api-keys',
    ['grok-4.7'],
  ],
];
const regional = new Set(['qwen', 'kimi', 'glm', 'minimax']);
export const MODEL_SERVICE_ENDPOINTS: readonly ModelServiceEndpoint[] = Object.freeze(
  entries.map(([id, label, baseUrl, model, protocol, keyUrl, models = []]) => {
    const service = id.endsWith('-intl') ? id.slice(0, -5) : id;
    const available = true;
    return Object.freeze({
      id,
      label,
      service,
      baseUrl,
      protocol,
      keyUrl,
      defaultModel: model,
      models: Object.freeze([model, ...models]),
      keyHint:
        (
          {
            deepseek: 'sk-…',
            qwen: 'sk-…',
            kimi: 'sk-…',
            openrouter: 'sk-or-…',
            openai: 'sk-…',
            anthropic: 'sk-ant-…',
            qianfan: 'bce-v3/…',
            xai: 'xai-…',
          } as Record<string, string>
        )[service] ?? '粘贴 API Key',
      region: id.endsWith('-intl')
        ? ('intl' as const)
        : regional.has(service)
          ? ('cn' as const)
          : ('global' as const),
      auth: protocol === 'browser' ? ('browser' as const) : ('api-key' as const),
      available,
      ...(!available
        ? {
            unavailableReason:
              protocol === 'browser' ? '需要浏览器登录适配' : '需要接入此服务的原生协议插件',
          }
        : {}),
      secretKey: id === 'deepseek' ? 'api-key' : id + '-api-key',
    });
  }),
);
export const modelService = (id: string): ModelServiceEndpoint | undefined =>
  MODEL_SERVICE_ENDPOINTS.find((item) => item.id === id);
export const modelProviderId = (id: string): string =>
  id === 'deepseek' ? 'responses' : 'responses-' + id;
