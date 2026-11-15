import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceSampler } from '../src/client/voice-sampler.js';

function withEnvironment(values, run) {
  const originals = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  try {
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(globalThis, key, { configurable: true, value });
    run();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('insecure page names HTTPS/loopback requirement without requesting a device', () => {
  let requested = false;
  withEnvironment(
    {
      isSecureContext: false,
      navigator: {
        mediaDevices: {
          getUserMedia() {
            requested = true;
          },
        },
      },
    },
    () => {
      assert.match(createVoiceSampler().unavailableReason(), /HTTPS.*localhost/);
      assert.equal(requested, false);
    },
  );
});

test('missing capture API is reported as unsupported rather than missing physical hardware', () => {
  withEnvironment({ isSecureContext: true, navigator: {} }, () => {
    assert.match(createVoiceSampler().unavailableReason(), /不支持.*接口/);
  });
});

test('supported capture API is only a preflight and does not obtain permission or create a context', () => {
  let effects = 0;
  class Context {
    constructor() {
      effects++;
    }
  }
  withEnvironment(
    {
      isSecureContext: true,
      navigator: {
        mediaDevices: {
          getUserMedia() {
            effects++;
          },
        },
      },
      AudioContext: Context,
      AudioWorkletNode: Context,
    },
    () => {
      assert.equal(createVoiceSampler().unavailableReason(), null);
      assert.equal(effects, 0);
    },
  );
});
