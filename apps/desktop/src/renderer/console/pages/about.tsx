import type { ConsoleSnapshot } from '@pet/contracts';
import type { JSX } from 'react';

import { ConsoleStatus } from '../console-status.js';
import { Card } from '../minimal-ui/controls.js';

export interface AboutPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
}

/**
 * 关于页：普通区只放产品信息（名称、版本、许可），
 * 技术版本收在「高级」那个原生折叠里——排查时才展开，平时不占视线。
 */
export function AboutPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
}: AboutPageProps): JSX.Element {
  return (
    <>
      <Card title="版本">
        <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
          {snapshot === null ? null : (
            <div className="rows rows--tight">
              <Row label="应用名称" value={snapshot.app.name} />
              <Row label="版本" value={snapshot.app.version} />
              <Row label="许可" value="MIT" />
            </div>
          )}
        </ConsoleStatus>
      </Card>

      {snapshot === null ? null : (
        <details className="card">
          <summary className="card__head">
            <span className="card__title">高级</span>
            <span className="row__value">技术信息</span>
          </summary>
          <div className="card__body">
            <div className="rows rows--tight">
              <Row label="Electron" value={snapshot.app.electron} />
              <Row label="Node" value={snapshot.app.node} />
              <Row label="平台" value={snapshot.app.platform} />
              <Row label="快照版本" value={String(snapshot.version)} />
            </div>
          </div>
        </details>
      )}
    </>
  );
}

/** 一行一项：名称在左，值落在右端同一条轨上。 */
function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="row">
      <span className="row__text">
        <span className="row__label">{label}</span>
      </span>
      <span className="row__value">{value}</span>
    </div>
  );
}
