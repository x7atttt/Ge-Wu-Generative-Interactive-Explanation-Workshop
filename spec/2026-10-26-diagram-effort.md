# 架构图块与思考强度切换

## 目标与边界

用户要求增加 diagram 块，不增加 image 块；提供现有模型 low、high、max 三档 effort 切换，完成后自查视觉。

- 架构图作为受限 DSL 内容，不执行模型生成的 HTML、SVG 或脚本。
- 使用 React Flow 展示、ELK 自动布局；提供节点说明、单层分组、步骤高亮、缩放与适应视图。
- 先排布组内模块，再排布组间关系，组间边通过分组边界接到实际模块；组内采用纵向流程。窄屏有步骤时默认聚焦第一步，单组聚焦保留分组标题。
- 只读教学图，不提供自由连线或编辑画布。流程中的返回边、残差连接允许存在。
- 节点和连线采用稳定 ID，校验重复 ID、引用缺失、分组和步骤引用。限制规模，避免不可读的大图。
- low/high/max 原值传给现有 Chat Completions reasoning_effort；前端默认 high，本机持久化。无请求参数的旧客户端继续使用环境变量，保留原 medium 配置兼容。
- UI 选择覆盖生成、深化、追问及相关自动修复；资料提炼与路线编排继续使用服务端默认配置。

## 数据契约

diagram: title、可选 caption、direction（LR/TB，可省略）、nodes（id/label/description/可选 group）、edges（id/source/target/可选 label、kind=data|residual）、可选 groups（id/label）、可选 steps（title/description/nodeIds/可选 edgeIds）。不让模型生成坐标和样式。

## 验收

- [x] 生成、流式展示、自动修复、存储恢复与深化均接受合法 diagram。
- [x] 非法引用和重复标识不能落库，原有 chart、wavePlot、练习保持正常。
- [x] 节点说明、分组、步骤切换、总览恢复和缩放可用；提供布局失败提示与重试入口。
- [x] 桌面与窄屏无页面横向溢出；长标签完整，图形与说明不遮挡；键盘可操作。
- [x] effort 选择持久化，生成/深化/追问/修复上游参数与选择一致，非法档位返回 400。
- [x] build、相关 Lint、接口与浏览器回归通过，并实际查看截图后修整。

## 实施顺序

先完成契约、渲染和模型指令，再接通 effort 全链路，最后使用隔离模型桩与可清理夹具验收。新依赖及官方参考记录在外层 reference.md。

## 验证范围

生产构建与隔离端口下的本地模型桩验收，不调用真实供应商。验证请求实际发送的 reasoning_effort、架构图的存储恢复与流式展示、非法引用的一次修复/拒绝、分组连线几何、节点/步骤交互和窄屏视觉。

最终 `pnpm build`、相关模块定向 ESLint 和 `python test/run-learning-loop.py` 均通过；完整脚本包含原有学习闭环、内容质量、生成修复、空间删除、悬停选择、轻量工具栏及新增 diagram/effort 验收。实际查看了桌面总览、步骤高亮和手机首次聚焦截图。

布局覆盖 LR/TB、单层分组与无分组、循环与自环、无连线模块及长标签。截图保存在 data/diagram-*.png，仅作为本地验收产物。

全量 pnpm lint 的现存基线为 9 个错误、3 个警告，涉及原有状态恢复 effect、流式文本 hook 和未使用变量；本次改动相关模块的定向 Lint 通过，未扩展修复范围。
