# 医药代表销售汇报工具

一个基于原生 `HTML + CSS + JavaScript` 的前端项目，用于医药销售录入、产品维护、指标管理与报表分析。

当前版本以 Supabase 为核心数据源，已接入认证与三张业务表：`products`、`sales_records`、`sales_targets`。

## 1. 模块能力总览

### auth
- 强制登录门禁（未登录不可操作业务区）。
- 认证方式：邮箱 + 密码（支持注册、登录、退出）。
- 登录后显示当前邮箱，支持退出。
- 检测到账号切换时自动刷新页面，避免串号状态。

### products
- 产品主数据云端读写：新增、编辑、删除、初始化加载。
- 删除前检查是否被记录使用（本地 + 云端）。
- 已被历史记录使用的产品不允许改名，仅允许改单价。
- 改单价时联动更新云端历史记录 `assessed_amount`。

### records
- 记录列表走云端分页查询（筛选、排序、分页、总数）。
- 新增、行内编辑、单删、批删、清空全部均走云端。
- 所有查询与写入按 `user_id` 隔离。

### targets
- 指标数据走 `sales_targets` 云端读写（按 `user_id + target_year`）。
- 支持季度目标、月度目标、产品月度分配。
- 包含“季度=月度合计”与“产品分配合计”一致性校验。

### reports
- 报表基于云端 records + 云端 targets 计算。
- 支持月度/季度/产品/医院分析与图表展示。
- 支持金额单位、图表主题、数据标签模式。

### import
- 支持下载导入模板（`xlsx`/`exceljs`）。
- Excel 导入采用 `250 行/块` 的串行分块批量写入云端 records。
- 批量失败时，仅在可判定的业务/数据错误下逐行回退；网络/超时等状态不确定错误不会逐行重试（避免重复插入）。
- 导入时若产品不存在会自动新增产品（单价默认 `0`）并同步到云端产品表。
- 导入重复检测规则：按“日期 + 标准化产品名 + 医院 + 配送 + 数量”识别并提示（不阻断导入）。

### export
- 报表表格导出 `XLSX`。
- 图表支持导出 `PNG` 与 `XLSX`。

## 2. 云端数据模型（当前实现）

### 2.1 `products`
- 读写范围：当前登录用户产品主数据。
- 关键字段映射：
  - `id` ← `product.id`
  - `user_id` ← 当前用户 `id`
  - `product_name` ← `product.productName`
  - `unit_price` ← `product.unitPrice`

### 2.2 `sales_records`
- 读写范围：当前登录用户销售记录。
- 关键字段映射：
  - `user_id` ← 当前用户 `id`
  - `record_date` ← `date`
  - `hospital_name` ← `hospital`
  - `product_name` ← `productName`
  - `purchase_quantity_boxes` ← `quantity`
  - `assessed_amount` ← `amount`
  - `channel` ← `delivery`
  - `actual_amount` / `remark`：当前写入 `null`

### 2.3 `sales_targets`
- 读写范围：当前登录用户年度指标。
- 关键字段映射：
  - `user_id` ← 当前用户 `id`
  - `target_year` ← 年份
  - `version` / `metric_type` ← 指标元信息
  - `year_data` ← 年度季度/月度/产品分配结构

## 3. localStorage 职责边界

### 仍在主流程使用
- `sales_form_draft_v1`（销售录入草稿）
- `sales_report_range_v1`（报表时间范围）
- `sales_report_chart_palette_v1`（图表主题）
- `sales_report_chart_data_label_v1`（图表标签模式）
- `sales_report_amount_unit_v1`（金额单位）

### 兼容保留（Deprecated，非主流程）
- `sales_product_master_v1`
- `sales_records_v1`
- `sales_records_v1:<user_id>`
- `sales_targets_v1`

说明：`products / sales_records / sales_targets` 的主数据来源均为 Supabase，以上 Deprecated 键仅为历史兼容代码保留。

## 4. 目录结构

```text
/Users/askakwok/Documents/Vibe Coding/Sales Tool
├── index.html                 # 页面结构与脚本入口
├── styles.css                 # 全站样式
├── main.js                    # 前端应用编排与模块装配
├── app/
│   ├── chat-client.js         # 聊天前端请求链路与业务快照装配
│   ├── create-app-deps.js     # 前端 deps 装配兼容层
│   └── smoke-tools.js         # Supabase smoke 调试工具
├── auth.js                    # 认证门禁、会话保持、注册/登录/退出
├── domain/
│   ├── entity-matchers.js     # 产品/医院命名归一化与匹配内核
│   └── report-snapshot.js     # 共享报表/业务快照聚合内核
├── infra/
│   ├── supabase-auth-context.js  # Supabase 鉴权上下文适配器
│   ├── products-repository.js    # 产品云端仓储
│   ├── records-repository.js     # 记录云端仓储
│   └── targets-repository.js     # 指标云端仓储
├── storage.js                 # 本地存储与数据规范化工具
├── products.js                # 产品维护与销售录入校验
├── records.js                 # 记录列表、多选、导入、云端读写
├── targets.js                 # 指标录入、分配、校验
├── reports.js                 # 报表渲染与导出（聚合核心已下沉到 domain）
├── functions/
│   ├── api/
│   │   └── chat.js            # AI HTTP 入口与 phase 串联
│   └── chat/
│       ├── shared.js          # AI 共享常量、格式化与基础工具
│       ├── session.js         # 历史窗口归一化
│       ├── conversation-state.js # 会话上下文归一化
│       ├── retrieval-context.js  # 命名识别辅助
│       ├── retrieval-data.js     # 数据拉取与窗口解析
│       ├── retrieval-enhancement.js # 聚合与快照增强
│       ├── tool-registry.js    # Tool calling 工具声明
│       ├── tool-executors.js   # Tool calling 工具执行器
│       ├── tool-runtime.js     # Planner + tool-first 主运行时
│       ├── render.js           # 最小 answer/reply 契约
│       └── output.js           # Gemini 请求与日志
├── config.example.js          # Supabase 配置模板
├── config.js                  # 运行时配置（构建生成，已 gitignore）
├── dist/                      # Cloudflare Pages 静态产物目录（构建生成，已 gitignore）
├── scripts/
│   ├── generate-config.js     # 按环境变量生成 config.js（本地）
│   └── build-pages.js         # 生成 dist/ 并写入 dist/config.js（部署）
├── tests/
│   ├── chat-api.test.js       # /api/chat 单链成功/失败回归测试
│   ├── chat-answer-contract.test.js # 最小 answer 契约测试
│   ├── tool-runtime.test.js   # Tool-first 运行时与规划回归测试
│   ├── tool-executors.test.js # 原语工具回归测试
│   └── infra-app.test.js      # 前端依赖装配回归测试
├── package.json
├── package-lock.json
└── vendor/
    ├── echarts.min.js
    ├── xlsx.full.min.js
    └── exceljs.min.js
```

## 5. 本地运行与检查

### 安装依赖
```bash
npm install
```

### 准备配置（任选其一）

1. 复制模板为 `config.js`
```bash
cp config.example.js config.js
```

2. 用环境变量生成 `config.js`
```bash
SUPABASE_URL=https://<your-project-ref>.supabase.co \
SUPABASE_ANON_KEY=<your-anon-or-publishable-key> \
npm run gen:config
```

### 启动本地服务
```bash
npm run dev
```
默认地址：`http://localhost:5173`

> `npm run dev` 仅提供静态页面，不包含 Cloudflare Pages Functions。

### 语法检查
```bash
npm run check
```

> 运行方式必须是 `http://`，不能 `file://` 直开。页面内置了 `file://` 拦截提示。

## 6. Supabase 配置说明

项目通过 `window.__APP_CONFIG__` 注入配置（`index.html` 会先加载 `config.js`）：

```js
window.__APP_CONFIG__ = {
  SUPABASE_URL: "https://<your-project-ref>.supabase.co",
  SUPABASE_ANON_KEY: "<your-anon-or-publishable-key>",
};
```

注意事项：
- `config.js` 已在 `.gitignore` 中忽略，不应提交。
- `SUPABASE_ANON_KEY` 可用于前端公开场景；不要使用 `service_role` key。
- 若缺少配置，登录按钮会被禁用并提示配置错误。

## 7. Cloudflare Pages 建议配置

- Root directory：`Sales Tool`
- Build command：`npm ci && npm run build:cf`
- Build output directory：`dist`
- Environment Variables（Production/Preview）：
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

## 8. 调试能力（开发期）

`app/smoke-tools.js` 会挂载一个 smoke 方法（入口仍由 `main.js` 调用）：
- `window.__SALES_TOOL_SUPABASE_SMOKE_WRITE__(options)`

用途：插入一条测试记录并回读（可选自动清理），快速验证 Supabase 写链路。

## 8.1 AI 真实日志采样

当前对话助手已经有两类可直接复用的线上日志：

- `chat.tool.trace`
  - 关注字段：
    - `requestId`
    - `planner_question_type`
    - `planner_requested_views`
    - `tool_call_count`
    - `evidence_types_requested`
    - `evidence_types_completed`
    - `missing_evidence_types`
    - `fallback_reason`
- `chat.error`
  - 关注字段：
    - `requestId`
    - `stage`
    - `error_name`
    - `error_message`

如果线上日志里没有原始问题文本，建议同步做一份最小手工样本记录，模板见：

```text
scripts/fixtures/chat-runtime-manual-samples.csv
```

建议记录字段：

- `requestId`
- `category`
- `question`
- `analysisRange`
- `uiResult`
- `notes`

### 采样命令

```bash
npm run analyze:chat-runtime -- \
  --tool-log /path/to/chat-tool.log \
  --error-log /path/to/chat-error.log \
  --samples /path/to/chat-runtime-manual-samples.csv \
  --out /path/to/chat-runtime-report.md
```

说明：

- `--tool-log` 必填，支持包含 `[chat.tool.trace]` 的混合文本日志或纯 JSONL。
- `--error-log` 可选，支持包含 `[chat.error]` 的混合文本日志或纯 JSONL。
- `--samples` 可选，支持手工采样 CSV 或 JSON。
- `--out` 可选；不传时，脚本会直接把 Markdown 报告输出到终端。

### 报告内容

脚本会按 `requestId` 串联样本和日志，输出固定结构：

- 样本总量
- 五类问题成功率
- 失败原因分布
- 失败样本（最多 10 条）
- 成功样本（最多 5 条）
- 下一轮修复优先级建议

若失败主要集中在以下原因，可按下面优先级判断：

- `planner_call_missing`
  - 优先修首轮入口或 planner 协议
- `empty_final_reply`
  - 优先修最终总结生成
- `tool_loop_limit_exceeded`
  - 优先修宏工具覆盖或 planner-取数匹配
- `tool_execution_failed`
  - 优先修具体工具字段、参数和执行器

## 9. 下一功能开发前手工验收清单

1. 未登录时业务区不可操作；登录后解除锁定。
2. 产品新增/编辑/删除与刷新后结果一致。
3. 记录新增、编辑、单删、批删、清空后刷新结果一致。
4. 导入包含“新产品名”的 Excel 后，刷新仍能在产品下拉中看到对应产品。
5. 导入与历史数据完全重复的行时，重复提示稳定出现。
6. 指标修改后刷新仍保留，报表联动变化正确。
7. 报表表格与图表导出可用（XLSX/PNG）。
8. 执行 `npm run check` 通过。
9. 登录后首屏销售记录列表能正常加载，控制台不再出现 `listStatusTimer is not defined`。

## 10. 已知边界与后续建议

- 并发冲突策略仍为“最后写入生效”，暂未实现基于 `updated_at` 的乐观锁。
- Excel 导入当前为“分块串行”策略，超大文件导入耗时仍可能较长。
- 当批量写入出现网络/超时等状态不确定异常时，系统不会逐行重试；需刷新页面核对后再决定是否重试。
- 当前已补一组 Phase 2 回归测试，覆盖命名匹配、有效主维度优先级、交叉路由互斥、`need_more_data` 收敛、`refuse` 不调用 Gemini、结构化错误兜底；业务 CRUD 与报表主链仍建议继续补自动化测试。
- 当前前端入口已收敛为“应用编排层”，Supabase 访问与云端行映射已迁移到 `infra/` repository；`products.js / records.js / targets.js / reports.js` 仍通过 `deps` 兼容层访问能力。
- 当导入后的产品同步失败时，系统会提示并尝试回拉云端产品；已写入的 records 不会回滚。

## 11. 聊天（阶段1：自然对话）

当前已恢复最小可用聊天链路（Cloudflare Pages Functions）：
- 前端聊天 UI 可发送消息。
- 后端 `POST /api/chat` 调用 Gemini 返回自然文本回答。
- `live` 模式要求登录态（`Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`）；`demo` 模式允许匿名请求，但只基于当前页面传入的模拟快照回答。

### 11.1 Cloudflare 配置

在 Pages 项目中配置以下项（Production / Preview）：

- Environment Variables：
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `GEMINI_MODEL`（可选，默认 `gemini-3.1-flash-lite-preview`）
- Secret：
  - `GEMINI_API_KEY`

说明：
- `GEMINI_API_KEY` 只放服务端 Secret，不放前端 `config.js`。
- 本阶段仅支持自然对话，不输出结构化 JSON。

### 11.2 角色定义（输入层第一步）

服务端已在 `functions/api/chat.js` 的 system prompt 中注入角色定义：

- 角色身份：你是医药销售业务分析助手。
- 角色目标：基于当前业务数据提供洞察，识别业绩、产品、医院与趋势中的关键问题和机会，并给出可执行下一步动作建议。
- 回答风格：简体中文、自然回答、结论先行、专业清晰，强调数据依据、关键判断和实际推进价值。
- 规则约束：
  - 不要编造数据；数据不足时明确说明。
  - 当前阶段不要输出JSON。
  - 可以引用当前输入中已有的业务代号、字段代号、产品代号、医院代号。
  - 不要编造不存在的字段、代号或含义。
  - 优先回答医药销售相关问题；对明显无关问题仅简洁说明职责范围，不展开回答。

说明：
- 阶段 1.1 仅注入角色定义；从阶段 1.2 起，聊天请求可携带最小业务快照 `business_snapshot`。
- `POST /api/chat` 请求/响应契约保持不变。

### 11.3 业务快照输入层（阶段1.2）

`POST /api/chat` 请求体新增可选字段 `business_snapshot`（向后兼容）：

- `message/history` 兼容保留；当前输入仅使用 `message / history / business_snapshot / conversation_state`；
- `business_snapshot` 为业务输入层，首版采用“8类骨架完整、5类必填、3类可空”的最小摘要策略。

骨架字段（snake_case）：

- `analysis_range`（对象）
- `performance_overview`（对象）
- `key_business_signals`（字符串数组）
- `product_performance`（对象数组）
- `hospital_performance`（对象数组，首版可空）
- `recent_trends`（对象数组）
- `risk_alerts`（字符串数组，首版可空）
- `opportunity_hints`（字符串数组，首版可空）

字段语义约束：

- `analysis_range` 仅表示分析时间范围，不作为“是否有可用业务数据”的判断依据。
- `key_business_signals` 仅保留真实业务信号，首版最多 `1~2` 条，也允许空数组 `[]`；后续层必须兼容其为空。
- `hospital_performance=[]` 在后续数据可用性层默认视为“医院维度无支撑”。
- 若后续需表达“医院维度弱支撑”，应使用非空但摘要不足的数据形态，不用空数组表达弱支撑。

首版值格式统一：

- 金额：`xx.xx万元`
- 比例：`xx.xx%`
- 变化：`+xx.xx%` / `-xx.xx%`
- 销量：`xx盒`
- 时间：`YYYY-MM`
- 区间：`YYYY-MM~YYYY-MM`

文本 + 结构化伴随字段规范：

- 结构化字段后缀统一使用 `_value / _ratio / _code`。
- `performance_overview`：`sales_amount_value`、`amount_achievement_ratio`、`latest_key_change_ratio`、`latest_key_change_code`、`sales_volume_value`。
- `performance_overview`（产品覆盖补充）：`product_catalog_count_value`、`product_snapshot_count_value`、`product_coverage_code`（`full|partial|none`）。
- `product_performance[*]`：`sales_amount_value`、`sales_share_ratio`、`sales_volume_value`、`change_metric_code`、`change_value_ratio`。
- `recent_trends[*]`：`sales_amount_value`、`amount_mom_ratio`、`sales_volume_value`。
- 文本字段与结构化字段必须同口径同来源，语义保持一致。

`product_performance.change_metric` 动态规则：

- 优先同比：`change_metric=金额同比`，`change_metric_code=amount_yoy`。
- 回退环比：`change_metric=金额环比`，`change_metric_code=amount_mom`。
- 都不可用：`change_metric=变化值`，`change_metric_code=unknown`，`change_value=--`，`change_value_ratio=null`。

本阶段边界：

- 不恢复全产品、全医院、全年月明细上下文；
- 不新增复杂风险识别与机会识别逻辑；
- 仅提供最小业务摘要供模型自然回答引用。

### 11.4 当前聊天主链

当前聊天后端包含两条模式分支：

- `live`：`鉴权与请求校验 -> planner-enhanced tool-first -> Gemini 基于工具结果生成文本 -> 返回 reply + answer`
- `demo`：`匿名限流与请求校验 -> snapshot-only Gemini -> 返回 reply + answer`

其中 `live` 分支里的 `planner-enhanced tool-first` 指：

- 模型先提交一份分析计划
- 运行时校验这份计划是否合法
- 合法后再按计划调用受控工具
- 工具返回结构化事实后，再由模型综合生成自然语言回答

两种模式都只基于当前 `business_snapshot.analysis_range`，也就是当前页面选中的报表区间；`demo` 分支不会访问 Supabase 或任何真实账号数据。

### 11.5 请求输入

`POST /api/chat` 当前使用以下输入：

- `message`
- `history`
- `business_snapshot`
- `conversation_state`
- `workspace_mode`（可选，`live | demo`；缺省按 `live` 处理）

模式约束：

- `workspace_mode=live`：沿用当前登录态校验和 tool-first 主链。
- `workspace_mode=demo`：允许无 `Authorization`，仅基于 `business_snapshot` 做自然语言回答，不访问真实数据。
- `workspace_mode=demo` 额外带有匿名限流：同一匿名指纹 10 分钟内最多 6 次请求，超限返回 `429` 与 `RATE_LIMITED`。

`conversation_state` 当前主要保留：

- `primary_dimension_code`：主分析维度代码
- `entity_scope`：实体范围
- `source_period`：来源时间段

### 11.6 状态机与规划阶段

运行时通过一份单一状态机 `systemInstruction` 约束模型行为。

模型分三阶段工作：

1. 首轮规划阶段  
   必须先调用 `submit_analysis_plan`，不能直接输出用户可见文本。
2. 深挖取数阶段  
   当证据不足且未达到调用上限时，继续调用工具补齐事实。
3. 最终总结阶段  
   停止调用工具，综合全部结果输出最终自然语言回答。

`submit_analysis_plan` 当前至少要给出：

- `relevance`
- `primary_dimension`
- `granularity`
- `route_intent`
- `question_type`
- `required_evidence`
- `requested_views`
- `required_tool_call_min`

如果 planner 不合法，运行时会返回 `accepted=false`，并要求模型重新提交；不允许跳过重规划直接调工具。

### 11.7 首轮宏工具门控

对于范围大、对象不明确的泛分析问题，首轮只向模型暴露少量高层宏工具：

- `get_sales_overview_brief`
- `get_sales_trend_brief`
- `get_dimension_overview_brief`
- `submit_analysis_plan`

目标是让泛问题先获得一版稳定的概览分析，避免模型一开始就拆成大量细工具调用。

对更具体、需要深挖的问题，后续轮次才会放开分析原语和兼容工具。

### 11.8 受控工具面

当前工具面分成两层。

高层宏工具：

- `get_sales_overview_brief`
- `get_sales_trend_brief`
- `get_dimension_overview_brief`

核心分析原语：

- `scope_aggregate`
- `scope_timeseries`
- `scope_breakdown`
- `scope_diagnostics`

兼容工具：

- `get_overall_summary`
- `get_product_summary`
- `get_hospital_summary`
- `get_product_hospital_contribution`
- `get_trend_summary`
- `get_period_comparison_summary`
- `get_product_trend`
- `get_hospital_trend`
- `get_entity_ranking`
- `get_share_breakdown`
- `get_anomaly_insights`
- `get_risk_opportunity_summary`

### 11.9 首批工具计划参数

planner 在 `initial_tools` 里提交首批工具计划时，当前使用结构化参数对象：

- `name`：工具名
- `args`：结构化参数对象

不再使用字符串形式的嵌套 JSON 参数。

运行时会在 planner 阶段直接校验：

- `args` 是否为对象
- 是否满足该工具的必填参数
- `requested_views` 中的工具是否在 `initial_tools` 中给出了可执行参数

坏参数不会再被吞掉继续执行，而是直接拒绝 planner。

### 11.10 工具返回与证据完成度

工具返回的不是最终文案，而是结构化事实。常见字段包括：

- `range`
- `matched_entities`
- `unmatched_entities`
- `coverage`
- `summary`
- `rows`
- `boundaries`
- `diagnostic_flags`

运行时会继续记录：

- `evidence_types`
- `missing_evidence_types`
- `analysis_confidence`

如果 planner 明确给了 `required_evidence`，运行时以 planner 为准；只有 planner 没给或给空数组时，才回退到问题类型的默认证据集合。

### 11.11 成功与失败收口

成功响应当前最小契约：

- `{ reply, answer, model, requestId }`

失败响应当前最小契约：

- `{ error: { code, message, details? }, requestId }`

当前 `answer` 最小字段：

- `summary`
- `evidence[]`
- `actions[]`
- `source_period`
- `question_type`
- `evidence_types[]`
- `missing_evidence_types[]`
- `analysis_confidence`
- `conversation_state`

如果模型已经形成可读分析文本，以下两类结果都会按成功返回：

- `direct_answer`
- `bounded_answer`

只有真正未形成稳定结果时才返回错误 JSON。

### 11.12 常见失败原因

当前运行时会将失败原因透传到 `error.details.reason`，常见值包括：

- `planner_call_missing`
- `planner_rejected_without_resubmission`
- `tool_loop_limit_exceeded`
- `tool_execution_failed`
- `empty_final_reply`
- `planner_relevant_without_tool`
- `gemini_error`
- `invalid_analysis_range`

前端会把这些原因映射成可读中文，而不是统一只显示一条笼统错误。

### 11.13 最小观测与验证

调试时建议重点关注：

- `requestId`
- `planner_relevance`
- `planner_route_intent`
- `planner_question_type`
- `planner_requested_views`
- `evidence_types_requested`
- `evidence_types_completed`
- `missing_evidence_types`
- `tool_call_count`
- `fallback_reason`

当前最小接口验证重点是：

- 成功请求能返回 `reply + answer + model + requestId`
- 泛分析问题优先走宏工具
- planner 不合法时必须重提
- 工具参数不合法时在 planner 阶段被拦下
- 失败时返回结构化错误 JSON，而不是本地兜底文案
