/** Immutable cached artifacts. Availability and runtime hash verification are separate. */
export interface LocalAsrFile {
  readonly name: string;
  readonly bytes: number;
  readonly sha256?: string;
  readonly gitBlobSha1?: string;
  readonly url: string;
}
export interface LocalAsrModel {
  readonly id: string;
  readonly name: string;
  readonly streaming: boolean;
  readonly source: string;
  readonly repository: string;
  readonly revision: string;
  readonly files: readonly LocalAsrFile[];
}
export const LOCAL_ASR_MODELS: readonly LocalAsrModel[] = [
  {
    id: 'sensevoice-small-int8',
    name: 'SenseVoice Small INT8',
    streaming: false,
    source: 'ModelScope',
    repository: 'pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
    revision: '73eca47697f980daa3d16112404174b6b950b514',
    files: [
      {
        name: 'model.int8.onnx',
        bytes: 239233841,
        sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
        url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/73eca47697f980daa3d16112404174b6b950b514/model.int8.onnx',
      },
      {
        name: 'tokens.txt',
        bytes: 315894,
        gitBlobSha1: '2cfc92fc2ff26aaa690b7c01fd96b41109413881',
        url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/73eca47697f980daa3d16112404174b6b950b514/tokens.txt',
      },
    ],
  },
  {
    id: 'streaming-paraformer-zh-en-int8',
    name: 'Paraformer 中英流式 INT8',
    streaming: true,
    source: 'ModelScope',
    repository: 'pengzhendong/sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    revision: 'c9d662eca7ca87765078148501659faa24e842ed',
    files: [
      {
        name: 'encoder.int8.onnx',
        bytes: 165462184,
        sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a',
        url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/c9d662eca7ca87765078148501659faa24e842ed/encoder.int8.onnx',
      },
      {
        name: 'decoder.int8.onnx',
        bytes: 71664561,
        sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f',
        url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/c9d662eca7ca87765078148501659faa24e842ed/decoder.int8.onnx',
      },
      {
        name: 'tokens.txt',
        bytes: 75756,
        gitBlobSha1: '57bc045ddda0434ed4440c38e14287c595b258d9',
        url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/c9d662eca7ca87765078148501659faa24e842ed/tokens.txt',
      },
    ],
  },
];
export const LOCAL_ASR_SAMPLE_RATE = 16000;
export const LOCAL_ASR_MAX_SECONDS = 20;
