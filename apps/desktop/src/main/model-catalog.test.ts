import { modelService, type KernelErrorCode, type ModelServiceEndpoint } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { expect, it, vi } from 'vitest';
import { fetchModelCatalog } from './model-catalog.js';

const key = 'catalog-fixture-key';

function endpoint(
  protocol: ModelServiceEndpoint['protocol'],
  baseUrl = 'https://catalog.invalid/root/v1/',
): ModelServiceEndpoint {
  const service = modelService('openai');
  if (!service) throw new Error('Missing fixed endpoint fixture');
  return { ...service, baseUrl, protocol };
}

async function expectFault(
  result: Promise<readonly string[]>,
  code: KernelErrorCode,
): Promise<void> {
  await expect(result).rejects.toBeInstanceOf(KernelFault);
  await expect(result).rejects.toMatchObject({
    message: 'errors.' + code,
    error: { code, messageKey: 'errors.' + code },
  });
}

it.each(['chat', 'responses'] as const)(
  'lists %s models with a GET at the supplied base, Bearer auth and no generation body',
  async (protocol) => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://catalog.invalid/root/v1/models');
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal });
      expect(init?.body).toBeUndefined();
      expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
        accept: 'application/json',
        authorization: 'Bearer ' + key,
      });
      return Response.json({
        data: [{ id: 'vendor/second' }, { id: 'first' }, { id: 'vendor/second' }],
      });
    });
    await expect(
      fetchModelCatalog(
        endpoint(protocol, ' https://catalog.invalid/root/v1/// '),
        key,
        signal,
        fetchImpl,
      ),
    ).resolves.toEqual(['vendor/second', 'first']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  },
);

it('uses native Anthropic headers and follows encoded after_id pagination in provider order', async () => {
  const signal = new AbortController().signal;
  const cursor = 'claude/page?x=1&next=two';
  const urls: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    urls.push(url.href);
    expect(url.origin + url.pathname).toBe('https://catalog.invalid/root/v1/models');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal });
    expect(init?.body).toBeUndefined();
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': key,
    });
    if (urls.length === 1) {
      expect([...url.searchParams]).toEqual([]);
      return Response.json({
        data: [{ id: 'claude-b' }, { id: cursor }],
        has_more: true,
        last_id: cursor,
      });
    }
    expect([...url.searchParams]).toEqual([['after_id', cursor]]);
    return Response.json({
      data: [{ id: 'claude-b' }, { id: 'claude-a' }],
      has_more: false,
      last_id: 'claude-a',
    });
  });
  await expect(
    fetchModelCatalog(
      endpoint('anthropic', 'https://catalog.invalid/root/'),
      key,
      signal,
      fetchImpl,
    ),
  ).resolves.toEqual(['claude-b', cursor, 'claude-a']);
  expect(urls).toHaveLength(2);
});

it('lists Gemini model names with header auth, strips only the leading prefix and encodes page tokens', async () => {
  const signal = new AbortController().signal;
  const token = 'next/+?x=1&key=value';
  let page = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://catalog.invalid/root/v1/models');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal });
    expect(init?.body).toBeUndefined();
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/json',
      'x-goog-api-key': key,
    });
    if (page++ === 0) {
      expect([...url.searchParams]).toEqual([['pageSize', '1000']]);
      return Response.json({
        models: [{ name: 'models/gemini-b' }, { name: 'tunedModels/custom' }],
        nextPageToken: token,
      });
    }
    expect([...url.searchParams]).toEqual([
      ['pageSize', '1000'],
      ['pageToken', token],
    ]);
    return Response.json({
      models: [{ name: 'models/gemini-b' }, { name: 'models/gemini-a' }],
      nextPageToken: '',
    });
  });
  await expect(fetchModelCatalog(endpoint('gemini'), key, signal, fetchImpl)).resolves.toEqual([
    'gemini-b',
    'tunedModels/custom',
    'gemini-a',
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('uses the caller browser root and returns only visible ChatGPT slugs', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe('https://catalog.invalid/backend-api/models');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(init?.body).toBeUndefined();
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ' + key,
    });
    return Response.json({
      models: [
        { slug: 'visible-b', visibility: 'list', id: 'ignored-id' },
        { slug: 'hidden', visibility: 'hidden' },
        { slug: 'visible-b', visibility: 'list' },
        { slug: 'visible-a', visibility: 'list' },
      ],
    });
  });
  await expect(
    fetchModelCatalog(
      endpoint('browser', 'https://catalog.invalid/backend-api/'),
      key,
      new AbortController().signal,
      fetchImpl,
    ),
  ).resolves.toEqual(['visible-b', 'visible-a']);
});

it.each(['chat', 'responses', 'anthropic', 'gemini', 'browser'] as const)(
  'returns a successful empty %s catalog without static suggestions',
  async (protocol) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        protocol === 'gemini' || protocol === 'browser' ? { models: [] } : { data: [] },
      ),
    );
    await expect(
      fetchModelCatalog(endpoint(protocol), key, new AbortController().signal, fetchImpl),
    ).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  },
);

it('returns an empty browser catalog when every model is hidden', async () => {
  await expect(
    fetchModelCatalog(endpoint('browser'), key, new AbortController().signal, async () =>
      Response.json({ models: [{ slug: 'hidden', visibility: 'hidden' }] }),
    ),
  ).resolves.toEqual([]);
});

it.each([
  [401, 'auth-failed'],
  [403, 'auth-failed'],
  [429, 'rate-limited'],
  [408, 'timeout'],
  [504, 'timeout'],
  [302, 'network'],
  [404, 'network'],
  [500, 'network'],
] as const)(
  'maps HTTP %s to a fixed %s fault without reading or echoing the error body',
  async (status, code) => {
    const response = new Response('private response ' + key, {
      status,
      headers: { location: 'https://other.invalid/' + key, 'x-private': key },
    });
    if (!response.body) throw new Error('Missing response body fixture');
    const cancel = vi.spyOn(response.body, 'cancel');
    const reader = vi.spyOn(response.body, 'getReader');
    const fetchImpl = vi.fn<typeof fetch>(async () => response);
    const error: unknown = await fetchModelCatalog(
      endpoint('chat'),
      key,
      new AbortController().signal,
      fetchImpl,
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(KernelFault);
    expect(error).toMatchObject({ message: 'errors.' + code, error: { code } });
    expect(String(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(key);
    expect(reader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  },
);

it('normalizes rejected redirects and transport details without retrying', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.redirect).toBe('error');
    throw new TypeError('private transport ' + key);
  });
  await expectFault(
    fetchModelCatalog(endpoint('chat'), key, new AbortController().signal, fetchImpl),
    'network',
  );
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([
  { protocol: 'chat', body: null },
  { protocol: 'chat', body: [] },
  { protocol: 'chat', body: {} },
  { protocol: 'chat', body: { data: {} } },
  { protocol: 'chat', body: { data: [null] } },
  { protocol: 'chat', body: { data: [{ id: 'valid' }, {}] } },
  { protocol: 'chat', body: { data: [{ id: 42 }] } },
  { protocol: 'chat', body: { data: [{ id: ' ' }] } },
  { protocol: 'chat', body: { data: [{ id: 'x'.repeat(129) }] } },
  { protocol: 'anthropic', body: { data: [], has_more: 'false' } },
  { protocol: 'anthropic', body: { data: [{ id: 'valid' }], has_more: true } },
  { protocol: 'anthropic', body: { data: [], has_more: true, last_id: 'cursor' } },
  { protocol: 'gemini', body: { data: [] } },
  { protocol: 'gemini', body: { models: [{ id: 'wrong-field' }] } },
  { protocol: 'gemini', body: { models: [{ name: 'models/' }] } },
  { protocol: 'gemini', body: { models: [], nextPageToken: 42 } },
  { protocol: 'gemini', body: { models: [], nextPageToken: 'x'.repeat(4097) } },
  { protocol: 'browser', body: { data: [] } },
  { protocol: 'browser', body: { models: [{}] } },
  { protocol: 'browser', body: { models: [{ id: 'wrong-field', visibility: 'list' }] } },
] satisfies { protocol: ModelServiceEndpoint['protocol']; body: unknown }[])(
  'rejects a malformed $protocol catalog rather than returning a partial or fallback list',
  async ({ protocol, body }) => {
    await expectFault(
      fetchModelCatalog(endpoint(protocol), key, new AbortController().signal, async () =>
        Response.json(body),
      ),
      'network',
    );
  },
);

it.each(['invalid-json', 'invalid-utf8', 'missing-body'] as const)(
  'normalizes %s responses as network faults',
  async (mode) => {
    const response =
      mode === 'missing-body'
        ? new Response(null)
        : new Response(mode === 'invalid-json' ? 'private malformed ' + key : Uint8Array.of(0xff));
    await expectFault(
      fetchModelCatalog(endpoint('chat'), key, new AbortController().signal, async () => response),
      'network',
    );
  },
);

it('decodes a JSON response split across a UTF-8 character boundary', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ data: [{ id: '模型' }] }));
  const split = bytes.findIndex((value) => value > 127) + 1;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    }),
  );
  await expect(
    fetchModelCatalog(endpoint('chat'), key, new AbortController().signal, async () => response),
  ).resolves.toEqual(['模型']);
});

it('bounds streamed response bytes even without a content length and closes the reader', async () => {
  const cancel = vi.fn();
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) =>
    controller.enqueue(chunk),
  );
  const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }));
  await expectFault(
    fetchModelCatalog(endpoint('chat'), key, new AbortController().signal, async () => response),
    'network',
  );
  expect(pull).toHaveBeenCalledTimes(3);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(response.body?.locked).toBe(false);
});

it.each([2000, 2001])('enforces the total %s model bound across pages', async (total) => {
  let page = 0;
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    const start = page++ * 1000;
    return Response.json({
      models: Array.from({ length: start === 0 ? 1000 : total - 1000 }, (_, index) => ({
        name: 'models/m-' + (start + index),
      })),
      ...(start === 0 ? { nextPageToken: 'second-page' } : {}),
    });
  });
  const result = fetchModelCatalog(
    endpoint('gemini'),
    key,
    new AbortController().signal,
    fetchImpl,
  );
  if (total === 2000) await expect(result).resolves.toHaveLength(2000);
  else await expectFault(result, 'network');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('accepts IDs at the save field length limit', async () => {
  const id = 'x'.repeat(128);
  await expect(
    fetchModelCatalog(endpoint('chat'), key, new AbortController().signal, async () =>
      Response.json({ data: [{ id }] }),
    ),
  ).resolves.toEqual([id]);
});

it.each(['anthropic', 'gemini'] as const)(
  'rejects repeated %s pagination cursors',
  async (protocol) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        protocol === 'anthropic'
          ? { data: [{ id: 'model' }], has_more: true, last_id: 'repeated' }
          : { models: [{ name: 'models/model' }], nextPageToken: 'repeated' },
      ),
    );
    await expectFault(
      fetchModelCatalog(endpoint(protocol), key, new AbortController().signal, fetchImpl),
      'network',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  },
);

it.each([
  ['anthropic', false],
  ['anthropic', true],
  ['gemini', false],
  ['gemini', true],
] as const)(
  'bounds %s to twenty pages when the final page continuation is %s',
  async (protocol, moreOnLast) => {
    let page = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      page++;
      const more = page < 20 || moreOnLast;
      return Response.json(
        protocol === 'anthropic'
          ? { data: [{ id: 'm-' + page }], has_more: more, last_id: 'm-' + page }
          : {
              models: [{ name: 'models/m-' + page }],
              ...(more ? { nextPageToken: 'page-' + page } : {}),
            },
      );
    });
    const result = fetchModelCatalog(
      endpoint(protocol),
      key,
      new AbortController().signal,
      fetchImpl,
    );
    if (moreOnLast) await expectFault(result, 'network');
    else await expect(result).resolves.toHaveLength(20);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  },
);

it.each(['cancelled', 'timeout'] as const)(
  'honors an already %s caller signal without fetching',
  async (code) => {
    const controller = new AbortController();
    controller.abort(
      code === 'timeout' ? new DOMException('private deadline ' + key, 'TimeoutError') : undefined,
    );
    const fetchImpl = vi.fn<typeof fetch>();
    await expectFault(fetchModelCatalog(endpoint('chat'), key, controller.signal, fetchImpl), code);
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

it('passes through caller cancellation during an outstanding fetch and sanitizes its reason', async () => {
  const controller = new AbortController();
  let notify = () => {};
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const fetchImpl = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        expect(init?.signal).toBe(controller.signal);
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('private cancellation ' + key)),
          { once: true },
        );
        notify();
      }),
  );
  const result = fetchModelCatalog(endpoint('chat'), key, controller.signal, fetchImpl);
  await started;
  controller.abort(new Error('private caller reason ' + key));
  await expectFault(result, 'cancelled');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('cancels an outstanding response read and starts no next page after caller cancellation', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  let notify = () => {};
  const reading = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const response = new Response(
    new ReadableStream(
      {
        pull() {
          notify();
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
  );
  const fetchImpl = vi.fn<typeof fetch>(async () => response);
  const result = fetchModelCatalog(endpoint('gemini'), key, controller.signal, fetchImpl);
  await reading;
  controller.abort();
  await expectFault(result, 'cancelled');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(response.body?.locked).toBe(false);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('closes a late response when the fetcher resolves after cancellation', async () => {
  const controller = new AbortController();
  const response = Response.json({ data: [{ id: 'late' }] });
  if (!response.body) throw new Error('Missing response body fixture');
  const cancel = vi.spyOn(response.body, 'cancel');
  await expectFault(
    fetchModelCatalog(endpoint('chat'), key, controller.signal, async () => {
      controller.abort();
      return response;
    }),
    'cancelled',
  );
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each([
  ['TimeoutError', 'timeout'],
  ['AbortError', 'cancelled'],
] as const)('normalizes transport %s failures to %s', async (name, code) => {
  await expectFault(
    fetchModelCatalog(endpoint('chat'), key, new AbortController().signal, async () => {
      throw new DOMException('private transport reason ' + key, name);
    }),
    code,
  );
});
