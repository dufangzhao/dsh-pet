# M1-05 配置、迁移与数据目录实现基线

## 受限Schema

prepareConfigDefinition(declaration, credentialKeys=[])返回Result<PreparedConfigDefinition>。declaration是config:{version,schema,apply?}本体，非整个清单。根为type:object且additionalProperties:false；只支持object/array/string/number/integer/boolean/null单类型，无ref、正则、组合/条件Schema、自定义代码或网络取数。Schema<=16KiB，深度<=8、节点<=256，每对象<=64字段，数组默认/最高256项，字符串默认/最高4096码点，integer限制安全整数。所有对象拒绝未知关键字或类型不适用关键字。

支持title/description/default、基本值enum/const，字符串minLength/maxLength，数值minimum/maximum，数组items/minItems/maxItems/uniqueItems，对象properties/required。default只用于构造候选副本，不修改输入，也不默默填进已保存值。缺必需字段且无默认值时未就绪。

format仅允许credential-ref，必须是string且enum为非空已声明credentialKeys子集；设置页应选择凭据引用，不接受明文Key。apiKey/password/accessToken/clientSecret/secret/authorization等明确敏感字段名不允许普通字符串配置。该检查不是DLP，不能识别任意改名字符串中的秘密；真实Key输入只允许宿主凭据专用路径。

PreparedConfigDefinition字段：version、schema（规范化冻结数据）、defaults（候选根对象）、fields（pointer/type/apply）；validate(unknown)返回Result<JsonObject>的自有冻结副本；changeMode(before,after)返回immediate/reload/restart或null。apply接受顶层裸字段名及嵌套JSON Pointer，拒绝未知路径；默认reload，祖先标注可继承。保存结果只是生效方式提示，不冒称运行中的实例已自动应用。

## 存储与服务

ConfigRecord={format:1,pluginId,instanceId,schemaVersion,revision,data}。实例身份由宿主绑定，持久化以身份哈希命名，配置值<=48KiB（为64KiB控制RPC的身份与迁移元数据留空间），记录<=96KiB；不接受插件相对路径。根目录必须已存在、规范化且无链接逃逸。按实例互斥并比较版本，临时文件独占创建/同步/改名，不在失败时退回覆盖写。文件损坏不自动重置覆盖，用户修复入口后续提供。

服务注册清单定义后才可访问命名空间；普通插件只有绑定owner世代的只读客户端。宿主save要求expectedRevision，拒绝过期写；每次保存先校验候选，CAS后才返回新快照。迁移先创建候选副本，通过目标Schema后才可提交；超时、取消、异常、非法结果不写旧文件。

迁移事务支持显式commit与rollback；rollback只在当前仍为本事务提交版本时恢复旧逻辑版本/数据，并继续增加revision，禁止ABA或覆盖后来的用户保存。插件升级前停用旧实例、升级启用失败后的事务回退由宿主编排。插件迁移代码必须通过运行区执行，单元测试注入函数不代表允许主进程执行插件代码。

## 数据目录

每插件/实例有宿主绑定的私有数据目录，哈希路径不接受插件任意路径。停用/卸载不自动删除配置、记录、模型；共享资源不归普通配置目录自行清理。已启动的原子提交可能完成，不能把取消后未知效果假报成回滚；错误不含值、Key或原始异常。

本轮不包含设置表单界面；由M2按此元数据生成，仍遵守DeepSeek前端分工。

## 运行区迁移与应用接线

PluginModule可选migrateConfig({fromVersion,toVersion,data,signal})，通过runtime.migrate在独立worker执行。仅发现包可用，入口与清单摘要匹配，目标config.version必须一致；已有实例未停止或同实例迁移仍执行时拒绝。主进程ConfigService保持目标Schema验证与持久化权威。全应用配置与plugin-data根均在用户数据目录，旧状态只读桥不暴露路径/配置值。

迁移事务discard只释放后续回退资格，不自动逆转已提交数据；成功升级后由宿主释放，激活失败时可在revision仍匹配时rollback。readiness不将配置合法当权限就绪。
