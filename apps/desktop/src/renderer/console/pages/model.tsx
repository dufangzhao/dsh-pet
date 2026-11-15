/** 模型页：只负责服务里的模型连接；开始页不再重复这一块。 */
import type { JSX } from 'react';

import type { CompanionView } from '../../shared/use-companion.js';
import { ModelCard } from './start.js';

export function ModelPage({ companion }: { companion: CompanionView }): JSX.Element {
  return <ModelCard companion={companion} />;
}
