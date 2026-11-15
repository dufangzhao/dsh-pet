# M5 design draft — ordinary MiMo streaming PCM, complete formal replies

Status: **user-approved implementation baseline after parent and independent consistency review**，2026-11-11。依据 [PRD O1–O9](prd.md)；接口/数值是待落地契约，不是已有API或live验收。用户已批准产品实现与受控验证，TTS调用仅走配置的Magpie网关；真实TTS/设备验证仍须单独明确范围。源码与新官方证据见 [research](research/speech-output-entry.md)。

## 1. 能力前提纠正与产品边界

官方 [TTS API][mimo-api]（2026-07-17）明确 `stream:true`、`audio.format=pcm/pcm16`、SSE `choices[].delta.audio.data`；[中文指南][mimo-guide]（2026-07-15）明确普通 `mimo-v2.5-tts` 低延迟流已上线/恢复，示例为 **24kHz PCM16LE mono**。voice-design/clone的stream兼容模式则在完整推理后仅返回一次结果。旧AstrBot adapter只实现nonstream WAV，不能推出普通MiMo无stream；**撤回64cp/250parts、23MiB完整JSON/16MiB PCM buffer及40s短段方案**。

[pinned Magpie nativeAny][magpie-native] 复制上游Content-Type、32KiB读/写后Flush、使用从r.Context进入p.Via/metered构造的NewRequestWithContext并defer关闭response body；body保留stream/audio字段，除原有privacy masking。该源码支持SSE增量转发及caller取消路径，没有native全响应收集。已定位本机discovery-only patch未见native.go/SSE转发改动；未找到运行部署的native.go或确认exact SHA，故不是本机已实际流播证明，也不证明vendor计算/计费停止。

- 用户启用真实optional内置feature后，自动读每条新committed正式assistant（含每次say正文），排除reasoning/delta/notice/rawtool；不做input modality归因。
- 长正式回复原文/顺序完整处理。一message一logical utterance，占旧FIFO一个槽；必要文本segment由service权威切分，不能截断/摘要/合并say或用旧整段2MiB拒绝长回复。
- 只在本实例Pet播放，console只有control/state，Web仍text/ASR且零TTS请求/播放器。defaultoff仍为最终review建议，旧true试听配置不迁auto授权；enable/reconnect/restart只收futureevents，不补历史/离线声音。
- 首codec明确选**普通MiMo原生SSE→PCM16流**；不暗中fallback非流式WAV/MP3/system-TTS，不扩大成ASR/VAD/full-duplex/自动打断。voice-design/clone此片nonselectable。
- 复用一个logical FIFO（current+pending≤4）、既有TaskSupervisor/TaskMediaPeer和Pet单owner；只增加流消费所必需的有界device buffer，不建business parts queue、预取manager、provider registry或audioDB/cache。

## 2. Source职责与实际入口

| 当前source/seam | 本片改动边界 |
| --- | --- |
| [Harness say](../../../../../plugins/harness-cortico/src/harness.mjs#L183)、[onRoundEnd](../../../../../plugins/harness-cortico/src/harness.mjs#L328)、[runtime publish](../../../../../packages/companion-runtime/src/runtime.ts#L1039) | 每次正式assistant commit触发一logical；不在模型token/toolwire另挂TTS。 |
| [state validator](../../../../../plugins/state-sqlite/src/validation.ts#L168)、[messages/events](../../../../../plugins/state-sqlite/src/state.ts#L382) | canonical已有≤8000 UTF-16 units、单message JSON≤28KiB；增严格只读 `getMessage({id,eventSequence})` 验证事件对应并取全文，不改DB表/schema。 |
| [Main follow](../../../../../apps/desktop/src/main/companion-client-controller.ts#L618)、[120ms schedule](../../../../../apps/desktop/src/main/companion-client-controller.ts#L567) | 在原单SSE reader逐event同步admit；UI合并刷新保留，播音不依赖snapshotdiff/latest。SSE继续只有messageId等metadata，不添正文/audio。 |
| [speech controller](../../../../../apps/desktop/src/main/speech-output-controller.ts)、[startup](../../../../../apps/desktop/src/main/index.ts#L366) | shared owner改为真实feature generation/capturedconnection。旧FIFO装logicalmetadata，head内只currentsegment/request/stream，不缓存全文PCM。 |
| [DesktopHost lifecycle](../../../../../apps/desktop/src/main/desktop-host.ts#L219)、[application ledger](../../../../../apps/desktop/src/main/shared-application-state.ts) | enable/disable真实source；原ledger增加allowlistedoptionalopt-in，joinMain+worker，不新建设置store。 |
| [old contract](../../../../../packages/contracts/src/speech-output.ts)、[player](../../../../../apps/desktop/src/renderer/speech-output/playback.ts)、[Pet owner](../../../../../apps/desktop/src/renderer/speech-output/playback-owner.tsx) | 旧player完整buffer/end后start不能直接复用为streaming；改单owner的bounded PCM scheduling、流身份/消费ACK/terminal与实际release。旧system v1 descriptor保留。 |
| [service composition](../../../../../apps/companion-service/src/service.ts)、[HTTP](../../../../../apps/companion-service/src/server.ts)、[M4 transport](../../../../../apps/companion-service/src/voice-client.ts) | 普通Magpie source、host-private固定purpose流transport/authority/media，不开放genericSDK网络/媒体或任意URL。 |
| [console panel](../../../../../apps/desktop/src/renderer/console/minimal-ui/speech-settings.tsx)、[persona page](../../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L251) | 真source开关、provider配置与流/播放/partialfailure/stop状态；不增consoleplayer。 |

拟议新增路径：`plugins/speech-output/{plugin.json,src/index.ts}`；`plugins/tts-magpie/{plugin.json,src/index.ts,src/config.ts,src/segments.ts,src/stream.ts}`；`packages/contracts/src/companion-speech.ts`（唯一public DTO/限额）；`packages/companion-runtime/src/speech-output-types.ts`（privateports）；`apps/companion-service/src/speech-{controller,http,client}.ts`；`apps/desktop/src/main/companion-speech-service.ts`。命名实施时对照实际types，不代表已经存在。

## 3. 真插件、provider与整条冻结

Desktop manifest pluginId=`pet.speech-output`、instanceId=`default`，actual linux-x64/win32-x64、非protected；`pet.speech-output/default`只是source引用，slash不是manifestID。PluginManager state/desiredActive为真相，首次缺记录off；原applicationledger的allowlistedoptionalEnabled只记录actuallyadopted用户启停，不从旧speechEnabled/试听/ASR启用推导auto授权。启用但provider未就绪真实显示unavailable；禁用fencewhole及join资源，不关Core/text/ASR/work。

实际分成与M4相同的三种source职责：本机optional `pet.speech-output`只拥有自动触发/设备播放；服务普通功能源`pet.shared-speech`拥有providerRef Config、SpeechView.feature/expectedFeatureRevision及SharedSpeechPorts的utterance生命周期，并提供`companion.speech.control@1`；服务普通提供者`pet.tts-magpie`（instanceId=`default`、providerId=`magpie`）拥有Magpie协议/绑定。桌面开关revision不冒充服务端Config，远端feature ready也不冒充本机已启用。均由existingServicePluginRegistration/PluginManager/TaskSupervisor/CredentialBroker装配，不建registry。host-private流port拟用新scope `companion.speech.output@1` 显式capability-use；旧 `speech.output@1` 已有known-total frames/2MiB语义不悄悄扩大或伪装为unknown-length stream。新stream start只含固定format/ref/identity，terminal才含真实frames/bytes。

Config proposal `{baseUrl,modelRef,authMode,protocol:'mimo-native-pcm16-sse',voice}`：沿M4 URL规则HTTPS或exact-loopbackHTTP，无userinfo/query/fragment，完整normalizedpath；独立projectUA/local-client-id，不模仿AstrBot。model默认空≤128；同一pureprojector做ordinaryMiMo codec/模型结构校验，save不GETcatalog/推理/缓存授权。显式catalog仅筛actualrows，metadata冲突unknown，ASR/chat/group/voiceclone/design/未知codec不可选，目录存在不证明stream/account权限。

普通模型voice为明确预置ID；官方列出冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean与mimo_default。后者按集群映射默认音色，不能当全球固定声音；推荐配置具体preset，冻结的是所选voice参数与sourcebinding，不保证未测的音质/物理同声线。首片不加user风格指令/音频标签/seed/emotion/rate语言映射；不设置 `optimize_text_preview:true`，该design选项会改正文，普通codec不启用。voice-design/clone非真低延迟路径另行范围，不通过same seed声称跨段固定音色。

TTS Key拟`tts-api-key`，独立text/ASR/DSH/AstrBot；processslot绑定provider+normalized完整target/auth，Config CAS/keyfreshversion/policy/sourcefingerprint沿existingauthority；target/auth提交先fence清key再falliblecleanup。Main writable=false，写Key只existing本机ingress，不relay秘密。

logicaladmission冻结canonical message/event、provider/model/voice/configrevision/keyversion/sourcegeneration/policy/binding、codecformat和splitVersion；这些权威或合成参数中途变化终止旧whole/currentstream/futuresegments，不能换声/改codec/重绑补播。本机volume在whole开始前读取并沿该whole使用；只改volume用于后续朗读，不中断当前whole。global soundEnabled关闭则本地stop并拒绝后续合成，旧speechEnabled不作auto许可。native values/errors/audio留private，supervisor JSON只传null/小metadata。

## 4. 事件、baseline与有限文本segments

1. enable、连接/follow重建、Agent/serviceepoch变化先挂host-onlylistener并baselining，freshsnapshot.cursor后只收futureevents；旧/迟到≤baseline事件不入FIFO，基线期间不补声。
2. segment-of-connection固定featureowner/connectionId/clientId/agentId/serviceepoch，单reader同步推进observedSequence；kind=message+role=assistant一条logical入既有FIFO，满额按messageId报告quota失败，不覆盖旧项、不另排队或恢复后补读；trustawait不能乱序。snapshotadopt不可吞尚未消费的events。重复sequence不再admit；service核对messageId+eventSequence防错误引用，不增无限seen集合。
3. FIFOhead在service读取canonical原文；不trim/normalize/改换行/Markdown/摘要，caller不得带正文/offset/count。保留原8000UTF16/28KiB，不加shortreplyrestriction。
4. 为沿用既有单次合成text边界、保留可控requestsize，splitVersion=2：**每native segment≤4000 code points**；余文≤4000一次提交，否则在2000..4000内取最后固定句末标点/换行后的合法边界，无则硬切4000，surrogatepair/CRLF不拆。连续UTF16offsetslice，`segments.join('')===canonical.text`，非末≥2000，所以canonical≤8000UTF16保证**最多4segments**。≤4000cp回复仅一次native请求；不因streambuffer拆成几十次合成。这是本项目请求边界，不声称已证vendor最大输入。
5. 每message一logical/FIFO槽，head内只currentsegment。**无跨segment预取**：当前stream成功terminal、native actualsettled、全部已调度PCM播放结束并release后，再发下一segment。stream内立即消费/播放首块，不等待整个segment结果；不是旧整段合成/播放循环。
6. 每segment一次原始nativePOST、一次binaryGET；nextsegment新index是正常首次调用，未知不重POST/重GET/换provider。任一segment失败/unknown停止whole余段，保留已调度/已结束block与completedSegment进度，不能跳段报全文complete。
7. stop/disable/offline/SSEended/readfailed/refreshfailed/retarget/source/Agent/epoch失效立即fencewhole+FIFO；stopping期间只推进事件边界，actualjoin后freshbaseline恢复future。badnativeSSEframe/SSEcontrol持久坏帧都失败/fence，不silentdrop。现 `protocol.ts` 的parseStreamMessage会将坏JSON/非法companion event变成null，Main listener收不到：为同一reader增加desktop-only严格错误观察入口，报告命名companion事件的badJSON/invalidEvent及UTF8/事件截断，立即fence并重建freshbaseline。合法keepalive/refresh/其他不相关事件不算坏正式消息；默认Web刷新语义不改变，不新开reader或靠snapshotdiff补读。

## 5. Native MiMo SSE→PCM codec

固定nativepath=`/magpie/native/<encoded vendor>/v1/chat/completions`，logical exposedID保留、wire baremodel；request是 `stream:true`、`messages:[{role:'assistant',content:服务原文slice}]`、`audio:{format:'pcm16',voice:冻结preset}`。nativeAccept=text/event-stream，strictcontenttype；收到nonstreamJSON/WAV是unsupported-protocol，不能暗fallback或重调用。

- incremental UTF8/SSE parser，网络切片不等于event/PCM block；保留跨read UTF8/CRLF/SSEevent碎片，单event≤1MiB，单decodedaudio块≤512KiB，过大明确失败。base64只在privatecodec，每event strictdecode，最大一字节PCM carry，流结束必须偶数/精确framealignment；再切≤256KiBmediachunks。
- 只消费choice.index=0的delta.audio.data；id/model/audioid若出现须一致，允许无choice的usage/已知空metadata但不让它们变成音频/重置audio-idle。多choice矛盾/未知破坏结构/无效base64报错，不把delta.content/reasoning/final_text_preview写进canonical或朗读。
- 官方固定codec=pcm-s16le/24000/mono；rawPCM无WAVheader，不能靠字节独立测出真实samplerate/channels，只能按这个明确protocol及后续live证据验证；不伪造“读header已证24k”。不动态猜格式/自动重采样；WebAudio自身将24kAudioBuffer输出到实际AudioContext设备rate。
- `finish_reason=stop`且至少一个完整PCM frame才是成功生成terminal；`length`/`content_filter`/error事件失败，已播prefix保留为partial。EOF或[DONE]但没有stop不是完成；stop后允许合法usage/[DONE]/EOF，不接受再来audio。nativecounter记录真实producedframes/bytes，终态与实际reader/borrow/tasksettled分开。
- 模型output标签解释/语义发音质量属于provider行为；本片保证提交的canonical text精确完整、不主动润色/截断，不能只凭stop证明每个字已被人听见。

## 6. 固定service流接口与purpose-ownedstate

| 入口proposal | 精确作用 |
| --- | --- |
| GET `/api/speech`、`/catalog`；POST `/provider`、`/credential` | boundedview≤16KiB/catalog≤48KiB，pureConfig/CAS/keyversion/本机ingress；provider启停走existingpluginroute，零隐式推理。 |
| POST `/api/speech/utterances` | caller已知logical utteranceId+canonical message/event+capturedAgent/epoch/client/providerbinding，service读全文/切分/冻结；返回logicalreceipt/segmentCount/splitVersion/opaque utteranceBindingId，不立即合成全部segments。 |
| POST `/api/speech/utterances/:id/segments` | caller预先分配requestId+currentsegmentindex+wholebinding；service只reserve nextindex及stream任务，不接callertext/offset；receipt=awaitingconsumer。 |
| GET `/api/speech/utterances/:id/segments/:index/audio` | 原子唯一consumer claim；fixedmetadataheader≤4KiB含pcm16/24k/mono/IDs，**attach后才开始该segment唯一nativePOST**，边生成边送binaryPCM，无Content-Length预估/整段buffer。no-store，不可重GET/范围下载。 |
| GET `/api/speech/utterances/:id` | boundedwhole/currentsegment状态、produced/drainedframes、finishreason/nativeSettled/transportcleanup，audioEOF后只读一次确认terminal，也用于一次unknown查询，无audio或重播恢复。 |
| POST `/api/speech/utterances/:id/cancel` | knownlogicalID即可wholefence、当前streamcancel+actualjoin，未收到taskreceipt也能cancel；不调用Core/work/ASRstop。 |

成功路径：logical/segmentreceipt→Pet对固定codec创建/resumeContext并回actualready（不是playing）→单次audioGET attach→codec/native TaskMediaPeer producer和reader**并行**→binaryHTTP backpressure→Main本地media→Pet消费ACK→native stopterminal+actualjoin+readerdrain→HTTP正常EOF→Main一次status核对stop/actualframes+settled→最后scheduledblock ended+release→下一segment/wholecomplete。service不能先awaitproducerresult再读media；writer.end等credits，reader必须持续消费，否则死锁。service binaryerror则destroy流，Main立即fence本地pendingaudio，status可取固定失败。**HTTP正常EOF也须terminalstatus确认，不能猜成功**。service必须在response.end()之前发布可被status读到的stop、exact produced/drained计数与nativeSettled终态；这里drained指media读尽并交给HTTPwriter，不以等待HTTP finish/close、Main status或Pet release为前置。响应finish/close可另记清理事实，不参与“是否允许调用end”的条件。

newsharedstreamstart只有format/identity/localmedia，不要求预知frames；finalstatus/end才给cumulativeframes。service owner/task/stream属于远端；Main另建本地feature-ownedTaskSupervisor/TaskMediaPeer，remoteproviderbinding只是provenance，不能冒充Mainauthority。

service最多4个active**logicalrecords**、每client一个；record只有≤8000units原文/≤4offsets/frozenbinding/currentsegmenthandle/attemptedThrough-deliveredThrough/lastmetadata。实际tasks由TaskSupervisor拥有，非新registry/queue；完成segment即释放bytes/task/decoder，不累积segmentterminal。wholeterminal≤32/120s仅在整条交付结束/取消且actualcleanup后计时，activewhole无120s总TTL。

logical/request IDs在POST前已知，requestId由logicalID/index确定，≤128；同index不能换ID重推理，重复同payload只能原receipt/状态，不重native；已claimedsegment音频不可再GET，future跳index拒绝。begin在首await前占identity；wholecancel-before-begin写同boundedmetadatafence，body≤15s、fence≥120s覆盖迟请求。activecancel原位更新不因terminal满无法停止自己，fence不能提前evict，建fence失败unknown不能假success。unknown/expired/restart不重新POST；正常admissionresponseclose不是native取消。

reserve后consumer未attach≤30s则取消（零nativecall）；logicalplan后首segment未到≤60s，segment播放/transport期间由下述阶段watchdog和actualprogress约束。真实disconnect就wholefence；无法即时确认peer丢失由consumerstall/idle收口，不把未settledrecordTTL清掉。无交付PCMcache，consumer断流不重新下载/重新合成。

## 7. Pet单owner的有界流播放与端到端背压

不新增worklet/resampler为前提。最直接实现是现有SpeechPlaybackOwner内用**bounded scheduled AudioBufferSourceNode**：将24kPCM按约100ms/2400frames块转Float32AudioBuffer，AudioBuffer自身sampleRate=24000；实际AudioContext可用设备rate，由WebAudio标准输出转换。维护一条调度时间轴、最多6个100ms blocks（约600ms）及一个当前IPC chunk的未处理余量。它是device资源窗口，不是新的业务queue/音频预取manager。

Main每次最多一个≤64KiB IPC PCM chunk在途；Pet只在这个chunk所有frames已进入有界node窗口或已播放后返消费ACK，窗口满等node.onended归还capacity，不立即ACK收到就无限enqueue。**每个IPC chunk末尾不足2400frames时立即按实际长度调度短node**，包括仅1frame；不得持有本chunk ACK等待下一chunk或verified end凑满100ms，否则Main也在等ACK而无法继续读到EOF。Main awaitACK后才继续读localmedia/HTTP；service HTTP.write/drain→TaskMediaPeercredits→nativeparser.read均按下游可写性推进。native最多1MiBevent/512KiBdecoded、kernel每peer2MiB窗口、Mainchunk64KiB、Pet6blocks+chunk余量，**resident audio与已生成总量/全文长度无关**。

Main在audioGET前先等同一Pet/frame的prepare-readyACK（Context.resume实际完成且running），准备失败/15s无进度则wholecancel，零nativePOST；server reserve到attach30s覆盖这个准备阶段，绝不以auto-consent/autoplay flags伪造ready。收到的binaryformatheader还须与准备的固定codec匹配。ready不是playing，source.start/AudioContextrunning只证明实际API调度，不是人耳证明。onended在currentidentity下累计已结束blockframes；整segment playbackcomplete须native成功terminal+最后node真实ended，随后awaitContext.close和pendingresume/creatework，才released/允许下一segment。underrun等待后续audio且有idlewatch，不丢/重复samples；饥饿时下一block重基到currentAudioContexttime，不伪造连续听到或精确词级playedprefix。

stop先同步撤whole/playbackepoch、移除onended、stop/disconnect所有schedulednodes、清ownedchunks，再awaitcontextclose/pendingwork；latechunk/resume/ACK不能start/推进。close拒绝真实失败，不能fire-and-forget。exact原Petframe可做cleanup-onlyACK，不获得新network/stream权限。native部分失败时立刻停止pendingnodes，已真实结束的blocks只是partial事实，不能回滚已经播出的声音或canonical消息。

## 8. Clock、累计配额与不混淆的事实

| 边界 | proposal及起点 |
| --- | --- |
| Canonical / native request | canonical≤8000UTF16/28KiB，segment≤4000cp/≤4；nativebody≤64KiB，不改controlJSON64KiB/Main80KiB。 |
| Stream event / buffers | SSEevent1MiB、decodedchunk512KiB；TaskMediaChunk256KiB/8credit/2MiB排队窗口原样；MainIPC≤64KiB×1，Pet≤6×100msblocks+当前chunk。不再保留23MiB完整JSON/16MiB完整PCM。 |
| Cumulative counters | 单segment PCM累计≤128MiB（24kmono约2796s），最多4segment逻辑上界512MiB，只计数/不alloc；与2MiBresident缓冲完全分离。长回复总PCM>旧2MiB仍可连续输出。有限guard不是已证语速或vendor限制。 |
| First audio | nativePOSTdispatch到第一有效PCM frame≤30s；headers/注释/usage/文字metadata不算firstaudio，不用40s/55s限制整条。 |
| Producer idle | 读上游且下游可接纳时，连续30s无有效PCM/terminal则失败；正常SSE元数据/keepalive不无限续命。因等待消费credits/HTTPdrain而主动暂停read的时间**不算producer idle**，恢复时重启该等待计时。 |
| Consumer stall | 无下游buffer/ACK/AudioContext进度的blocked状态最多15s；健康播放每个node/credit进度续这个stall期限。resume/权限失败立即可见，不拿本方背压误报vendoridle。 |
| Absolute | native/audio单segmentwall-clock≤60min，涵盖长流与正常背压，deadline只发cancel，actualcleanup继续join；不是40s长流卡死判断。whole无55s/120s硬限，最多4段和生命周期约束。 |
| Consumer/orphan/尾音 | reserve→attach30s，plan→firstsegment60s；stream期间用first/idle/stall/absolute；remoteEOF后先独立status20s核对，**verifiedterminal/end下发后**device尾音watchdog=实际queued剩余frames/24000+15s，不让status等待抢占尾音预算；service已交付segment等待nextindex最多实际segment时长+75s（保守允许播放/控制），不按whole创建时间清合法流。 |
| Status / terminal | EOF后一次statuscontrol20s；必须stop+exactproduced/drainedframes+nativeSettled才生成完成，devicecomplete/released另算；wholeterminal32/120s从whole实际remote清理后起，不能淘汰活跃record。 |

firstaudio、idle、consumerstall、absolutecap分别实现，不能一个普通20sJSON/60sbodytimeout套住流。service/Main发送/读取受背压时保持同一requestidentity；不silentlyretry或通过切小重调用规避任何失败。

## 9. Whole fence、真实join与验收

参数/source/key/config/target失效先fencewhole与futuresegments，本地stop立即执行，不等分类器/network；然后cancel currentnative，join实际SSEreader/parser/media/binaryfetch/credentialuse/task.settled与Petrelease/workerdispose。HTTPabort/Taskresult.cancelled不等nativeactualsettled；service/status分nativeSettled/transportdrained与deviceplayed/released，只有最后segmentstop确认、完整接收、全部nodesended/released才whole播放完成，仍不推断人耳听见。outcome（完成/失败/取消/unknown）与cleanup（pending/settled/failed）是独立维度：失败或取消也可以cleanup settled，不能因已清理改报朗读完成；旧idle/no-current不构成release证据。

仅在既有session仍live、auth/config/source仍有效时，远端wholecancel+join可以确认。现 [#retire](../../../../../apps/desktop/src/main/companion-client-controller.ts#L903) 先发布retiring，voiceSession.run会拒绝；endpoint切换还先提交CAS，host.withToken会按原configRevision/baseUrl拒绝旧source。**不为TTS改写M4 CAS/撤权顺序、不新增retired-token通道，也不把延后清token当授权。** 已retiring/CAS/revoke/offline时，立即本地wholefence、abort既有流并真实join设备/本地任务，无法确认的remote cleanup留在原target为unknown，由服务已断consumer/watchdog收口；它不串到新target，也不伪称远端settled。appquit在仍可用时先awaitspeech.close及Petrelease再退役连接/销毁Petframe，不能沿旧voidclose→dispose丢失本地release证明。providerwithdrawal沿现有SSErefresh合并读取speechproviderbinding，非另开poller/假称瞬时观察。feature停用不取消共享provider其他消费者，Core/work/ASR与M4mic-start保持。

必需受控探针：

1. 真optional lifecycle/defaultoff/旧true不迁移、同120ms多say逐logical、SSE无正文、snapshot裁剪/duplicate/badframe/enable/reconnect不补播，Webtext/ASR零TTS。
2. segmentconcat精确canonical、Unicode/CRLF/空白/8000UTF16，≤4000cp一次请求、longcanonical≤4segments且只一个FIFO槽；不出现64cp/几十次requests。
3. controllednativeSSE将UTF8/JSON/base64跨networkreads、usage-only/stop/length/content_filter/缺terminal/截断/oversize/奇数tail；**第一PCM在producer尚未结束时进Pet**，old>2MiB累计流仍完整有序、buffer峰值固定。
4. 慢consumer/AudioContext暂停触发真实背压；healthyreadpause不误触produceridle，stall超限取消；>8chunks writer.end与reader/status无环；顺序nativepackets/credits/IPCconsume/nodeended无丢帧重复。
5. stream>40s/55s/120s正常progress不被旧deadline杀死；firstaudio/activeidle/consumerstall/absolute/尾音分别gated；stopsegment2→segment3call0，latebytes/resume/ACK0play，partialfailure不报全文完成。
6. 真TaskSupervisor/Permission/media/sourceCAS/target-Key/drain，延迟nativecleanup/contextclose/workerdispose仍pending，close拒绝不能假released或启同资源替换；ordinaryvoice整条固定，design不可选。
7. root/Core/Docker/controlledElectronMain/preload/Pet+console/WebASR回归。后续另授权单次短livegate查实际gatewaySSE Content-Type、多audiochunks在terminal前到达、framealignment/终态/实际timestamps；rawPCM无header，采样率是官方codec契约而非读字节测得。不把source/fixtures当本机已live、声学质量/人耳/full-duplex/远端停计费证明。

Parent最终review应替换旧whole-buffer前提，明确普通PCM streaming、≤4canonicalsegments、固定小窗口背压、unknown不重试、真实stop/drain和voice-design暂缓；O7/O8/O9不再重问。

[mimo-api]: https://mimo.mi.com/docs/en-US/api/audio/tts
[mimo-guide]: https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5
[magpie-native]: https://raw.githubusercontent.com/yetone/magpie/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/native.go
