import type { IncomingMessage, ServerResponse } from 'node:http';
import { isCompanionRecordId, QQ_PAGE_MAX_ITEMS, type QQView, type Result } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { QQController } from './qq-controller.js';

function ingressView(view: QQView, writable: boolean): QQView {
  return {
    ...view,
    sources: view.sources.map((source) => ({
      ...source,
      credential: { ...source.credential, writable: source.credential.writable && writable },
    })),
    judge: {
      ...view.judge,
      credential: {
        ...view.judge.credential,
        writable: view.judge.credential.writable && writable,
      },
    },
  };
}
function page(url: URL): { after?: string; limit?: number } {
  if (
    [...url.searchParams.keys()].some((key) => key !== 'after' && key !== 'limit') ||
    url.searchParams.getAll('after').length > 1 ||
    url.searchParams.getAll('limit').length > 1
  )
    throw new KernelFault('invalid-input');
  const after = url.searchParams.get('after');
  const limit = url.searchParams.get('limit');
  if (after !== null && !isCompanionRecordId(after)) throw new KernelFault('invalid-input');
  if (limit !== null && (!/^[1-9]\d*$/.test(limit) || Number(limit) > QQ_PAGE_MAX_ITEMS))
    throw new KernelFault('invalid-input');
  return { ...(after ? { after } : {}), ...(limit ? { limit: Number(limit) } : {}) };
}
export async function qqHttp(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly writable: boolean;
  readonly qq: QQController;
  body(request: IncomingMessage): Promise<unknown>;
  send<T>(response: ServerResponse, status: number, result: Result<T>): void;
}): Promise<boolean> {
  const { request, response, url, writable, qq, body, send } = input;
  const route = url.pathname;
  if (request.method === 'GET') {
    if (route === '/api/qq') {
      send(response, 200, { ok: true, value: ingressView(await qq.view(), writable) });
      return true;
    }
    if (route === '/api/qq/status') {
      send(response, 200, { ok: true, value: await qq.status() });
      return true;
    }
    if (route === '/api/qq/deliveries' || route === '/api/qq/principals') {
      const { after, limit } = page(url);
      const value =
        route === '/api/qq/deliveries'
          ? await qq.deliveries(after, limit)
          : await qq.principals(after, limit);
      send(response, 200, { ok: true, value });
      return true;
    }
    const detail = /^\/api\/qq\/deliveries\/([^/]+)$/.exec(route);
    if (detail?.[1]) {
      let id: string;
      try {
        id = decodeURIComponent(detail[1]);
      } catch {
        throw new KernelFault('invalid-input');
      }
      if (!isCompanionRecordId(id)) throw new KernelFault('invalid-input');
      send(response, 200, { ok: true, value: await qq.delivery(id) });
      return true;
    }
    return false;
  }
  if (request.method !== 'POST') return false;
  if (
    ![
      '/api/qq/policy',
      '/api/qq/source',
      '/api/qq/credential',
      '/api/qq/judge',
      '/api/qq/judge/credential',
    ].includes(route)
  )
    return false;
  if (route.endsWith('/credential') && !writable) throw new KernelFault('permission-denied');
  if ([...url.searchParams].length) throw new KernelFault('invalid-input');
  const command = await body(request);
  const value =
    route === '/api/qq/policy'
      ? await qq.savePolicy(command)
      : route === '/api/qq/source'
        ? await qq.saveSource(command)
        : route === '/api/qq/credential'
          ? await qq.credential(command)
          : route === '/api/qq/judge'
            ? await qq.saveJudge(command)
            : await qq.judgeCredential(command);
  send(response, 200, { ok: true, value: ingressView(value, writable) });
  return true;
}
