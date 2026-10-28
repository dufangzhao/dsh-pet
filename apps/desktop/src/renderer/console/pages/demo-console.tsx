import { type JSX } from 'react';

import { Button } from '@pet/ui-kit';

import type { DemoState } from '../use-demo.js';

export interface DemoRecorderProps {
  demo: DemoState;
}

/**
 * 录音控制视图：会话只在 useDemo 里有一份，切去权限页审批也不会把麦关掉。
 * 这里只按当前状态给按钮——「结束并识别」只请求停止（提交识别由 ended 回调一次完成），
 * 「取消这次录音」才作废这一次。
 */
export function DemoRecorder({ demo }: DemoRecorderProps): JSX.Element | null {
  const { snapshot, recording, left, pending, startRecording, endRecording, cancelRecording } =
    demo;
  if (snapshot === null) {
    return null;
  }
  return (
    <div className="demo-recorder">
      <div className="demo-recorder__actions">
        {recording === null ? (
          <Button
            size="small"
            variant="primary"
            disabled={!snapshot.canRecord || pending.has('record')}
            data-testid="demo-record"
            onClick={() => void startRecording()}
          >
            开始录音
          </Button>
        ) : (
          <>
            <Button
              size="small"
              variant="primary"
              data-testid="demo-record-end"
              onClick={() => void endRecording()}
            >
              结束并识别
            </Button>
            <Button
              size="small"
              data-testid="demo-record-cancel"
              onClick={() => void cancelRecording()}
            >
              取消这次录音
            </Button>
          </>
        )}
        <span className="console-muted">
          {recording === null
            ? `说完点「结束并识别」才开始识别，本次最长 ${snapshot.maxRecordingSeconds} 秒。`
            : `剩余 ${Math.max(0, left ?? recording.seconds)} 秒，超时自动结束。`}
        </span>
      </div>
    </div>
  );
}
