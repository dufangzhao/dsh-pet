/**
 * 五件上游原件的读取处：Vite 把 vendored 的 .html 按字节读成字符串，对照板直接吃这一份。
 *
 * 路径都在 site-ui/upstream/ 里，随应用一起打包；不引 .trellis/tasks（任务归档会换路径，
 * 引了就等于把一个会消失的地方当运行时依赖）。
 */
import afraidSquid51 from './upstream/Buttons/andrew-demchenk0_afraid-squid-51.html?raw';
import politeStingray67 from './upstream/Inputs/andrew-demchenk0_polite-stingray-67.html?raw';
import emptyPenguin100 from './upstream/Toggle-switches/andrew-demchenk0_empty-penguin-100.html?raw';
import stupidSeahorse9 from './upstream/Radio-buttons/andrew-demchenk0_stupid-seahorse-9.html?raw';
import afraidCougar9 from './upstream/Forms/andrew-demchenk0_afraid-cougar-9.html?raw';

/** 上游的 slug：与 source-manifest.json 里的 items[].slug 一一对应。 */
export type RawSourceSlug =
  | 'afraid-squid-51'
  | 'polite-stingray-67'
  | 'empty-penguin-100'
  | 'stupid-seahorse-9'
  | 'afraid-cougar-9';

export interface RawSource {
  readonly slug: RawSourceSlug;
  /** 作者在这一件里写下的那一行（原样，含在字节里）。 */
  readonly author: 'andrew-demchenk0';
  readonly permalink: string;
  /** 上游仓库里的那一个文件（定到 revision）。 */
  readonly upstreamFile: string;
  /** vendored 的相对路径，给说明行与测试用。 */
  readonly vendoredFile: string;
  /** source-manifest.json 记下的 SHA-256。 */
  readonly sha256: string;
  /** 上游原件的完整字节：markup + 自己的 <style>。 */
  readonly source: string;
  /** 这一件在本机走到哪一步：已接还是只把原件摆在这儿对照。 */
  readonly adopted: boolean;
}

const UPSTREAM_REVISION = 'adbd2adde0a299a3956ea288fb444ec01891ca41';

function upstreamFile(category: string, slug: string): string {
  return 'uiverse-io/galaxy@' + UPSTREAM_REVISION + '/' + category + '/' + slug;
}

function entry(
  slug: RawSourceSlug,
  category: string,
  file: string,
  source: string,
  sha256: string,
  adopted: boolean,
): RawSource {
  return {
    slug,
    author: 'andrew-demchenk0',
    permalink: 'https://uiverse.io/andrew-demchenk0/' + slug,
    upstreamFile: upstreamFile(category, file),
    vendoredFile: 'upstream/' + category + '/' + file,
    sha256,
    source,
    adopted,
  };
}

export const RAW_SOURCES: Readonly<Record<RawSourceSlug, RawSource>> = {
  'afraid-squid-51': entry(
    'afraid-squid-51',
    'Buttons',
    'andrew-demchenk0_afraid-squid-51.html',
    afraidSquid51,
    '11cfdd7d14b5b7c3268f8baa33298dac310ad81916cc129ee50fe3d30691f7f0',
    true,
  ),
  'polite-stingray-67': entry(
    'polite-stingray-67',
    'Inputs',
    'andrew-demchenk0_polite-stingray-67.html',
    politeStingray67,
    '02e77dbd3c0a45d5beff3c249fcc066b1914fb10951dca95983643fc48e7401e',
    true,
  ),
  'empty-penguin-100': entry(
    'empty-penguin-100',
    'Toggle-switches',
    'andrew-demchenk0_empty-penguin-100.html',
    emptyPenguin100,
    '4a3cb08d7e4684838d47c56aec476432f54f1715bc9ab09d9256dbdd4731c4c7',
    true,
  ),
  'stupid-seahorse-9': entry(
    'stupid-seahorse-9',
    'Radio-buttons',
    'andrew-demchenk0_stupid-seahorse-9.html',
    stupidSeahorse9,
    'd0b435d6c672d2aec197fa54810d5cfd944881263fb6acd65f7e0c75a5262a05',
    false,
  ),
  'afraid-cougar-9': entry(
    'afraid-cougar-9',
    'Forms',
    'andrew-demchenk0_afraid-cougar-9.html',
    afraidCougar9,
    '791fda9edbce04a8e5d6a70279db2851340708074ce3af69fe38ce766192a338',
    false,
  ),
};

/** 板上说的顺序：三件已接在前，两件同作者的延伸在后。 */
export const RAW_SOURCE_ORDER: readonly RawSourceSlug[] = [
  'afraid-squid-51',
  'polite-stingray-67',
  'empty-penguin-100',
  'stupid-seahorse-9',
  'afraid-cougar-9',
];
