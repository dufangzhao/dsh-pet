import { type JSX } from 'react';

import { Button } from '../minimal-ui/controls.js';
import type { DemoState } from '../use-demo.js';

export interface DemoRecorderProps {
  demo: DemoState;
}

/**
 * 录音控制视图：会话只在 useDemo 里有一份，切去权限页审批也不会把麦关掉。
 * 这里只按当前状态给按钮——「结束并识别」只请求停止（提交识别由 ended 回调一次完成），
 * 「取消这次录音」才作废这一次；剩下的秒数说的是服务端票据给的真实上限。
 */
export function DemoRecorder({ demo }: DemoRecorderProps): JSX.Element | null {
  const { snapshot, recording, left, pending, startRecording, endRecording, cancelRecording } =
    demo;
  if (snapshot === null) {
    return null;
  }
  return (
    <div className="card__foot">
      {recording === null ? (
        <Button
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
            variant="primary"
            data-testid="demo-record-end"
            onClick={() => void endRecording()}
          >
            结束并识别
          </Button>
          <Button data-testid="demo-record-cancel" onClick={() => void cancelRecording()}>
            取消这次录音
          </Button>
        </>
      )}
      <span className="row__value" role="status">
        {recording === null
          ? `最长 ${snapshot.maxRecordingSeconds} 秒`
          : `剩余 ${Math.max(0, left ?? recording.seconds)} 秒`}
      </span>
    </div>
  );
}
