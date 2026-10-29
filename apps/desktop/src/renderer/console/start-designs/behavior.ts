/**
 * Start 的纯判断：目录怎么归组、这一家能不能保存、回执该说哪一句。
 *
 * 不认 React、不认样式，只认宿主给的那份快照。分成这一层是为了让普通入口与五种排法共用
 * 同一套规则：版式作者在自己的文件里再写一遍 if，五份"差一点点"的判断就免不了。
 *
 * 所有 guard 都正着说「能不能」（canSave），渲染处自己取反给 disabled。
 * 上一轮就有一处把正着说的判断直接塞进 disabled，按钮与规则反着长；命名与顺序按这个约定。
 */
import type { ModelConnectionSnapshot, ModelService, SavedModelEndpoint } from '@pet/contracts';

import type { ModelSaveResult, ModelTestResult } from '../use-model-connection.js';
import { describeTest, saveMessage } from '../use-model-connection.js';

/** 一家厂商在目录里的那一行：main 是这一家，alt 是它另一块平台（要切过去才用得到）。 */
export interface ProviderRow {
  readonly name: string;
  readonly main: ModelService;
  readonly alt?: ModelService;
}

/**
 * 端点按厂商归组：同一家两块平台只占一行。
 * main 优先给中国大陆那块，另一块挂 alt——目录少一排重复名字，切换仍在详情里给。
 */
export function providerRowsOf(services: readonly ModelService[]): ProviderRow[] {
  const rows: ProviderRow[] = [];
  for (const item of services) {
    const at = rows.findIndex((row) => row.name === item.service);
    if (at < 0) {
      rows.push({ name: item.service, main: item });
      continue;
    }
    const row = rows[at];
    if (row === undefined) {
      continue;
    }
    const prefer = row.main.region === 'intl' && item.region !== 'intl';
    rows[at] = prefer
      ? { name: row.name, main: item, alt: row.main }
      : { name: row.name, main: row.main, alt: item };
  }
  return rows;
}

/** 一行里可能出现在搜索里的名字：厂商名、标识、两块平台各自的可填模型。 */
function rowHaystack(row: ProviderRow): string {
  const alt = row.alt;
  return [
    row.main.label,
    row.main.id,
    row.main.service,
    ...row.main.models,
    ...(alt === undefined ? [] : [alt.label, alt.id, ...alt.models]),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * 目录搜索：空白查询返回整份目录（不造「全部」这个概念），其余按子串命中，忽略大小写。
 * 匹配不过滤可用性——未接入的那一行仍然看得见并说明原因，这是上一版确认过的呈现。
 */
export function searchRows(rows: readonly ProviderRow[], query: string): ProviderRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...rows];
  }
  return rows.filter((row) => rowHaystack(row).includes(needle));
}

/**
 * 详情该给哪一家：用户点过的 → 这台机器在用的 → 第一家接得进来的 → 目录第一项。
 * 目录读不到就是没有目标，返回 undefined，不替用户猜一家。
 */
export function resolvePicked(
  rows: readonly ProviderRow[],
  pickedId: string | null,
  activeId: string | null,
): ModelService | undefined {
  const all = rows.flatMap((row) => (row.alt === undefined ? [row.main] : [row.main, row.alt]));
  return (
    all.find((item) => item.id === pickedId) ??
    all.find((item) => item.id === activeId) ??
    rows.find((row) => row.main.available)?.main ??
    rows[0]?.main
  );
}

/** 同厂商的另一块平台：真的存在另一块时才有「改用…」那一句。 */
export function siblingOf(
  services: readonly ModelService[],
  picked: ModelService | undefined,
): ModelService | undefined {
  if (picked === undefined) {
    return undefined;
  }
  return services.find((item) => item.service === picked.service && item.region !== picked.region);
}

/**
 * 一行该怎么标：在用 / 本机存过这条配置 / 当前挑了但本机还没有 / 可以挑 / 接不进来。
 *
 * 顺序就是事实的优先级：**真实已存的状态排在"是不是当前"前面**。
 * 保存写入了 Key、但那次探测被网络拒了（active 仍是 null）时，这一家已经算"本机存过"，
 * 再说"还没保存"就是谎报。反过来，没被挑中也没有存过的家不许喊"还没保存"。
 */
export type ProviderMark = 'in-use' | 'saved' | 'draft' | 'available' | 'unavailable';

export function providerMark(options: {
  readonly available: boolean;
  readonly inUse: boolean;
  readonly current: boolean;
  readonly keySaved: boolean;
}): ProviderMark {
  if (!options.available) {
    return 'unavailable';
  }
  if (options.inUse) {
    return 'in-use';
  }
  if (options.keySaved) {
    return 'saved';
  }
  return options.current ? 'draft' : 'available';
}

export const MARK_TEXT: Readonly<Record<ProviderMark, string>> = {
  'in-use': '在用',
  saved: '本机存过 Key',
  draft: '挑了，还没保存',
  available: '可选',
  unavailable: '未接入',
};

/**
 * 一行右边那句注记：讲这一家自己的真信息（怎么接进来、存过没有）。
 * dirty 只补当前那一家的一个事实：输入框里的内容与本机存的那份不一样，改动还没写进去。
 */
export function providerNote(
  mark: ProviderMark,
  auth: ModelService['auth'],
  dirty = false,
): string {
  if (mark === 'in-use') {
    return dirty ? '在用，这次改动还没保存' : MARK_TEXT['in-use'];
  }
  if (mark === 'unavailable') {
    return MARK_TEXT.unavailable;
  }
  if (mark === 'saved') {
    if (dirty) {
      return '本机存过 Key，这次改动还没保存';
    }
    return auth === 'browser' ? '本机存过 Key，也可用浏览器登录' : '本机存过 Key，填新的会覆盖';
  }
  if (mark === 'draft') {
    return MARK_TEXT.draft;
  }
  return auth === 'browser' ? '可选，用浏览器登录' : '可选，填 API Key';
}

/**
 * 输入框里的内容与本机存的那份是否不同：填了 Key 就是不同；
 * 没存过就当空的草稿不算改动（不然刚挑一家就被说成"有未保存的改动"）。
 */
export function draftDiffers(
  stored: Pick<SavedModelEndpoint, 'model'> | null,
  model: string,
  key: string,
): boolean {
  if (key.trim() !== '') {
    return true;
  }
  const written = model.trim();
  return stored === null ? written !== '' : written !== stored.model.trim();
}

/**
 * 「现在在用」那一格该怎么说：这条配置正在用 / 这台机器此刻谁都没用 / 在用者是别的一家。
 * 用回执写入时的事实（receiptActive）配上此刻的真实 active，别把"没有在用"说成"用了别家"。
 */
export function activeNote(options: {
  readonly receiptActive: boolean;
  readonly activeId: string | null;
  readonly activeLabel: string | null;
  readonly writtenId: string;
}): { readonly tone: 'on' | 'off' | 'warn'; readonly text: string } {
  if (options.receiptActive || options.activeId === options.writtenId) {
    return { tone: 'on', text: '就是这一家' };
  }
  if (options.activeId === null) {
    return { tone: 'off', text: '当前没有在用连接' };
  }
  return { tone: 'warn', text: '在用的是' + (options.activeLabel ?? '别的一家') };
}

/**
 * 保存前按用户看得懂的顺序报第一句原因：写入在飞、这家接不进来、模型名空着、Key 还没有。
 * 返回 null 表示可以保存。
 *
 * Key 留空只有一种情况成立：填的正是这台机器在用的那一家。换了一家就要给新 Key。
 */
export function saveBlockReason(options: {
  readonly saving: boolean;
  readonly picked: ModelService | undefined;
  readonly model: string;
  readonly key: string;
  readonly inUse: boolean;
}): string | null {
  if (options.saving) {
    return '上一次保存还没写完。';
  }
  if (options.picked === undefined) {
    return '还没读到可以保存的服务。';
  }
  if (!options.picked.available) {
    return options.picked.unavailableReason ?? '这一家在这台机器上还没接进来。';
  }
  if (options.model.trim() === '') {
    return '模型名不能空着。';
  }
  if (options.key.trim() === '' && !options.inUse) {
    return '这一家还没有可用的 Key：填一个，或改回在用的那一家。';
  }
  return null;
}

export const canSave = (options: Parameters<typeof saveBlockReason>[0]): boolean =>
  saveBlockReason(options) === null;

/** 测试连接只对这台机器真正在用的那一家成立：草稿没写过就不算它的测试结果。 */
export function testBlockReason(options: {
  readonly testing: boolean;
  readonly hasActive: boolean;
}): string | null {
  if (!options.hasActive) {
    return '还没有在用的连接：先保存一家，再测它。';
  }
  if (options.testing) {
    return '上一次测试还没回来。';
  }
  return null;
}

export const canTest = (options: Parameters<typeof testBlockReason>[0]): boolean =>
  testBlockReason(options) === null;

/** 浏览器登录：正在进行时等或取消，这家接不进来时不给按。 */
export function signInBlockReason(options: {
  readonly signingIn: boolean;
  readonly available: boolean;
}): string | null {
  if (options.signingIn) {
    return '正在等这台机器读到登录结果。';
  }
  if (!options.available) {
    return '这一家在这台机器上还没接进来。';
  }
  return null;
}

export const canSignIn = (options: Parameters<typeof signInBlockReason>[0]): boolean =>
  signInBlockReason(options) === null;

/**
 * Key 这一栏为什么用不了：只报真实原因，别把「没存过」说成「存不进去」。
 * null 表示这一栏正常可填。
 */
export function keyBlockReason(snapshot: ModelConnectionSnapshot | null): string | null {
  if (snapshot === null) {
    return '还没读到这台机器的模型配置。';
  }
  if (!snapshot.credentialStorageAvailable) {
    return '本机凭据存储不可用：现在写进去也存不住。';
  }
  return null;
}

/** 这一家在本机是否已存有 Key：读宿主的 endpoint 记录，不靠 Key 栏有没有字猜。 */
export function keySavedFor(
  snapshot: ModelConnectionSnapshot | null,
  id: string | undefined,
): boolean {
  if (snapshot === null || id === undefined) {
    return false;
  }
  return snapshot.endpoints.some((item) => item.id === id && item.keyConfigured);
}

/**
 * 这一节的整体读法：读不到桥 / 正在读 / 没接过 / 存过没在用 / 在用（含暂停）。
 * 「已保存未测」与「在用」是两件事，暂停也不改变在用的是哪一家。
 */
export type SectionPhase =
  | 'no-bridge'
  | 'loading'
  | 'read-failed'
  | 'nothing-yet'
  | 'saved-only'
  | 'in-use'
  | 'in-use-paused';

export function sectionPhase(
  available: boolean,
  snapshot: ModelConnectionSnapshot | null,
  loading: boolean,
  error: string | null,
): SectionPhase {
  if (!available) {
    return 'no-bridge';
  }
  if (snapshot === null) {
    if (error !== null) {
      return 'read-failed';
    }
    return loading ? 'loading' : 'nothing-yet';
  }
  if (snapshot.active !== null) {
    return snapshot.paused ? 'in-use-paused' : 'in-use';
  }
  return snapshot.endpoints.length > 0 ? 'saved-only' : 'nothing-yet';
}

/** 三条事实分开：写进本机没有、探测过没过、这台机器现在用不用它。 */
export interface SaveReceipt {
  readonly saved: boolean;
  readonly tested: boolean;
  readonly active: boolean;
  /** 给用户的那一句仍由所有者（use-model-connection）决定措辞，这里只补结构化结论。 */
  readonly text: string;
}

export function saveReceiptOf(result: ModelSaveResult, id: string): SaveReceipt {
  return {
    saved: result.saved,
    tested: result.saved && result.test !== null && result.test.ok,
    active: result.saved && result.activeId === id,
    text: saveMessage(result, id),
  };
}

/** 一次测试的结论：测过了没有、通没通、宿主原话。 */
export interface TestReceipt {
  readonly ran: boolean;
  readonly passed: boolean;
  readonly text: string;
}

export const testReceiptOf = (result: ModelTestResult): TestReceipt => ({
  ran: true,
  passed: result.ok,
  text: describeTest(result),
});

/** 登录走到哪一步：waiting 是还在等用户，不是失败也不是成功。 */
export function signInLine(phase: string | undefined, signedIn: boolean): string | null {
  if (phase === undefined) {
    return null;
  }
  if (signedIn) {
    return '这台机器读到登录完成了，接着才谈连接。';
  }
  if (phase === 'waiting') {
    return '正在等你在浏览器里完成登录；没读到结果之前不算已连接。';
  }
  return phase === 'failed' ? '登录没有完成。' : null;
}

/** 一句失败的话：原因照宿主报上来的原文，不改写。 */
export const failureLine = (why: string): string => '连接没有成功：' + why;

/**
 * 录不了音的三种原因是三件事：读不到状态、被暂停、没配识别模型。
 * 只取这三项，调用方给整个 DemoSnapshot 也行。
 */
export function micBlockReason(
  snapshot: {
    readonly paused?: boolean;
    readonly canRecord?: boolean;
    readonly settings?: { modelId: string | null };
  } | null,
): string | null {
  if (snapshot === null) {
    return '正在读取录音状态';
  }
  if (snapshot.paused === true) {
    return '桌宠已暂停，继续回应后可录音';
  }
  if (snapshot.canRecord !== true) {
    return snapshot.settings?.modelId === null ? '请先在语音输入中完成设置' : '现在还不能录音';
  }
  return null;
}

/** 桌面上有没有这一只：只报宿主说的那一句，不在这里推断。 */
export function desktopPresence(
  desktop: {
    readonly available: boolean;
    readonly shown: boolean;
  } | null,
): { readonly mark: 'on' | 'off'; readonly text: string } {
  if (desktop === null || !desktop.available) {
    return { mark: 'off', text: '桌宠未就绪' };
  }
  return desktop.shown ? { mark: 'on', text: '在桌面上' } : { mark: 'off', text: '已隐藏' };
}
