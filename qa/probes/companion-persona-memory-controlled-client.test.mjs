// Fixture-only check: no service, Core, network or model execution.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlledClient } from '../fixtures/companion-service/controlled-client.mjs';

const request = { model: 'controlled-offline', input: [] };
async function exercise(options, heldCount) {
  const fixture = options === undefined ? controlledClient() : controlledClient(options);
  const promises = [];
  try {
    for (let index = 1; index <= heldCount + 1; index++) {
      const promise = fixture.client.respond(request);
      void promise.catch(() => {});
      promises.push(promise);
      const flight = await fixture.next(index);
      if (index <= heldCount) {
        assert.equal(flight.done, false);
        flight.complete();
      } else assert.equal(flight.done, true);
      const result = await promise;
      assert.equal(result.response.status, 'completed');
    }
  } finally {
    fixture.close();
    await Promise.allSettled(promises);
  }
}

test('default keeps first two controlled responses and auto-completes the third', async () => {
  await exercise(undefined, 2);
});
test('explicit bounded hold allows a third response before automatic completion', async () => {
  await exercise({ holdResponses: 3 }, 3);
});
test('invalid or unbounded options are rejected before any response is requested', () => {
  for (const options of [{ holdResponses: Infinity }, { holdResponses: -1 }, { holdResponses: 13 },
    { holdResponses: 1.5 }, { extra: true }, null, []]) {
    assert.throws(() => controlledClient(options), TypeError);
  }
});
