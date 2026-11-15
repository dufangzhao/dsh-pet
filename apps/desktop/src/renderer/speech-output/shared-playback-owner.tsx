import { useEffect } from 'react';
import { SharedSpeechPlaybackOwner } from './stream-playback.js';

/**
 * 桌宠窗口里唯一的语音播放 owner，只挂一次。
 *
 * 桥缺失时什么都不做：这台机器没有新语音通道，不是"静音"。旧 `petSpeechOutput`
 * 是另一个 v1 契约，不强转、不混用。
 */
export function SharedSpeechPlaybackMount(): null {
  useEffect(() => {
    const bridge = window.petSharedSpeech;
    if (!bridge) return;
    const owner = new SharedSpeechPlaybackOwner(bridge);
    const detach = bridge.onAudio((event, payload) => owner.receive(event, payload));
    return () => {
      detach();
      owner.close();
    };
  }, []);
  return null;
}
