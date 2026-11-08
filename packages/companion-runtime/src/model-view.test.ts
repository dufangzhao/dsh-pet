import { expect, it } from 'vitest';
import type { CompanionModelView } from '@pet/contracts';
import { createInitialModelView } from './model-view.js';

it('serializes the default adapter as unconfigured without claiming an enabled or tested model', () => {
  const view = createInitialModelView(7, 'process-fixture:slot-fixture');
  const serialized: CompanionModelView = JSON.parse(JSON.stringify(view)) as CompanionModelView;
  expect(serialized).toEqual(view);
  expect(serialized.desired).toEqual({
    mode: 'scripted',
    connectorId: 'pet.model-connection-magpie/magpie',
  });
  expect(serialized.applied).toBeNull();
  expect(serialized.enabled).toBe(false);
  expect(serialized.check.state).toBe('unconfigured');
  expect(serialized.connectors[0]?.credential).toEqual({
    required: false,
    available: true,
    source: 'local-client-id',
    version: 'process-fixture:slot-fixture',
    writable: false,
  });
  expect(JSON.stringify(view)).not.toContain('apiKey');
});
