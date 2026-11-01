import { useEffect } from 'react';
import { SpeechPlaybackOwner } from './playback.js';

/** Mount exactly once in the Pet root; settings windows never own playback. */
export function SpeechOutputPlaybackOwner(): null {
  useEffect(() => {
    const bridge = window.petSpeechOutput;
    if (!bridge) return;
    const owner = new SpeechPlaybackOwner(bridge);
    const detach = bridge.onAudio((event, payload) => owner.receive(event, payload));
    return () => {
      detach();
      owner.close();
    };
  }, []);
  return null;
}
