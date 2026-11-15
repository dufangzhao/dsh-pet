/** 桌宠页：只保留桌宠显示与交互，不再和连接、模型挤在一起。 */
import type { JSX } from 'react';

import type { CompanionView } from '../../shared/use-companion.js';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';
import { PetCard } from './start.js';

export function PetPage({
  companion,
  presentation,
  notify,
}: {
  companion: CompanionView;
  presentation: LocalPresentationView;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}): JSX.Element {
  return <PetCard companion={companion} presentation={presentation} notify={notify} />;
}
