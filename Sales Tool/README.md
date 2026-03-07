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
│       ├── judgment.js        # 问题判定层
│       ├── availability-core.js    # 数据可用性通用判定
│       ├── availability-support.js # 模式化 support code 解析
│       ├── availability.js    # 数据可用性层兼容出口
│       ├── session.js         # 会话状态层
│       ├── routing-rules.js   # 路由 reason 与决策表
│       ├── routing.js         # 路由层兼容出口
│       ├── retrieval-context.js     # 命名识别与检索上下文解析
│       ├── retrieval-data.js        # 按需补强数据拉取与窗口解析
│       ├── retrieval-enhancement.js # 按需补强聚合与快照增强
│       ├── retrieval.js             # 按需补强层兼容出口
│       ├── tool-registry.js         # Tool calling 工具声明
│       ├── tool-executors.js        # Tool calling 工具执行器
│       ├── tool-runtime.js          # Tool-first 运行时与 fallback 编排
│       └── output.js          # 输出层、QC、trace
├── config.example.js          # Supabase 配置模板
├── config.js                  # 运行时配置（构建生成，已 gitignore）
├── dist/                      # Cloudflare Pages 静态产物目录（构建生成，已 gitignore）
├── scripts/
│   ├── generate-config.js     # 按环境变量生成 config.js（本地）
│   └── build-pages.js         # 生成 dist/ 并写入 dist/config.js（部署）
├── tests/
│   ├── phase2-domain.test.js  # Phase 2 纯函数回归测试
│   ├── chat-api.test.js       # /api/chat 结构化错误与编排回归测试
│   ├── fallback-decision.test.js # fallback support/routing 决策回归测试
│   ├── output-tool-consistency.test.js # deterministic tool 输出一致性与 QC 回归测试
│   ├── tool-router.test.js    # 高置信问题确定性工具路由测试
│   └── tool-runtime.test.js   # Tool-first 运行时与工具编排回归测试
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
- 聊天请求要求登录态（`Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`）。

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

- `message/history` 兼容保留；`mode` 仅支持 `auto` 或省略；
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

### 11.4 问题判定层（Phase 2.1）

后端已新增轻量前置分类 `questionJudgment`（仅请求作用域内可访问），用于后续数据可用性层和路由层复用。

首版固定输出 3 项（code + label）：

- `primary_dimension`：`overall|product|hospital|trend|risk_opportunity|other`
- `granularity`：`summary|detail`
- `relevance`：`relevant|irrelevant`

判定规则：

- 主维度优先级：`product > hospital > trend > risk_opportunity > overall > other`
- 细度：命中“具体/分别/明细/各月/每月/top/排名/列出来/详细拆解”等信号判为 `detail`，否则默认 `summary`
- 相关性：仅拦“明显无关”，判不稳默认 `relevant`
- 产品维度固定关键词已扩充：`产品/品种/单品/规格/药品/药物/用药/品规/剂型` 等；其中“药”单字有护栏，需与分析动作词共现（如“哪个/哪些/表现/贡献/销量/销售/分析/对比/推进/重点”）才作为产品高置信信号。
- 医院维度固定关键词已扩充：`医院/终端/门诊/机构/诊所` 等，支持非“医院”字面问法的稳定命中。
- 命名产品问法支持“精确+归一化匹配”产品目录：当消息直接命中已录入产品名时，可在请求内将有效主维度提升到 `product`（不回写外部响应）。
- 命名医院问法支持“全称/简称提及”识别：当消息中提及具体医院（含简称）时，可在请求内将有效主维度提升到 `hospital`（不回写外部响应）；简称仅在唯一匹配单医院时生效。

边界（本阶段）：

- 不写响应体
- 不写入 prompt
- 不持久化
- 不做路由/补调/多轮纠偏

验收样例：

- “这个月整体怎么样” -> `overall / summary / relevant`
- “重点做哪个产品” -> `product / summary / relevant`
- “哪家医院最重要” -> `hospital / summary / relevant`
- “近三个月趋势怎么样” -> `trend / summary / relevant`
- “当前最大的风险是什么” -> `risk_opportunity / summary / relevant`
- “把近三个月每个月数据分别列出来” -> `trend / detail / relevant`
- “今天天气如何” -> `other / summary / irrelevant`
- “帮我看看这个情况” -> `overall / summary / relevant`
- “接下来怎么推进” -> `risk_opportunity / summary / relevant`

### 11.5 数据可用性层（Phase 2.2）

后端已新增 `dataAvailability`（仅请求作用域内可访问），基于 `business_snapshot + questionJudgment` 做 4 项内部判断：

- `has_business_data`：`available|unavailable`
- `dimension_availability`：`available|partial|unavailable`
- `answer_depth`：`overall|focused|detailed`
- `gap_hint_needed`：`yes|no`

本阶段边界：

- 仅做规则判断，不引入模型参与。
- 不参与最终回答生成，不对外返回。
- 不注入模型输入（prompt），不持久化。

关键语义锁定：

- `analysis_range` 不参与“是否有业务数据”判断。
- `hospital_performance=[]` 在本阶段默认视为医院维度无支撑。
- 有效值语义：`"0"`、`"0.00%"`、`"0盒"`按有效值处理；缺失值仅使用明确占位符（如 `-- / unknown / 空字符串`），不使用 `"0"` 表示缺失。
- `overall` 维度判定以 `performance_overview` 为主支撑：
  - `performance_overview` 有效，且 `key_business_signals` 或 `recent_trends` 任一有效 -> `available`
  - `performance_overview` 仅自身有效 -> `partial`
  - `performance_overview` 无效但其他整体支撑存在 -> `partial`
- `risk_opportunity` 若仅由 `key_business_signals` 支撑而判为 `partial`，语义是“可做泛判断，不可视为专门风险/机会依据”。
- 医院维度在 `detail` 且命中“逐月明细请求”时，`answer_depth=detailed` 需依赖 `hospital_performance[*].monthly_points` 的有效覆盖；仅有医院汇总行不再直接判为 `detailed`。
- 产品维度在命中“全产品问法”时，`dimension_availability` 按覆盖度判定：
  - `product_coverage_code=full` -> `available`
  - `product_coverage_code=partial` -> `partial`
  - `product_coverage_code=none` -> `unavailable`
- 产品维度命中“命名产品问法”（精确+归一化匹配产品目录）时，`dimension_availability` 按命名覆盖度判定：
  - `product_named_support=full` -> `available`
  - `product_named_support=partial` -> `partial`
  - `product_named_support=none` -> `unavailable`
- 医院维度命中“命名医院问法”时，`dimension_availability` 按命名覆盖度判定：
  - `hospital_named_support=full` -> `available`
  - `hospital_named_support=partial` -> `partial`
  - `hospital_named_support=none` -> `unavailable`
- `detail_request_mode` 扩展为：`hospital_monthly|product_full|product_hospital|product_named|hospital_named|generic`；命中交叉/命名场景时会输出 `product_hospital_support / product_named_support / hospital_named_support`（`full|partial|none`）用于内部观测。

与会话状态层关系（本阶段锁定）：

- `dataAvailability` 仍仅基于当前轮 `questionJudgment + business_snapshot` 计算。
- 本阶段 `dataAvailability` 不消费 `sessionState`；会话承接对数据可用性层的影响留待后续阶段接入。

### 11.6 会话状态层（Phase 2.3）

后端新增 `sessionState`（仅请求作用域内可访问），用于会话承接/切题状态判断。固定 4 个布尔字段：

- `is_followup`
- `inherit_primary_dimension`
- `inherit_scope`
- `topic_shift_detected`

输入与窗口：

- 输入仅使用当前 `message` + `history`（最近窗口）。
- 历史窗口只保留历史内容，不包含当前 `message`。

关键约束：

- `topic_shift_detected=true` 时，仅强制：
  - `inherit_primary_dimension=false`
  - `inherit_scope=false`
- 允许“承接式切题”：`is_followup=true` 与 `topic_shift_detected=true` 可并存。
- `is_followup=false` 时，继承字段均为 `false`。

判定边界（首版）：

- 仅规则/启发式，不引入模型参与判定。
- 短追问信号采用“短句精确承接”判定（如“为什么/具体呢/那医院呢/那产品呢/那趋势呢”），避免“重点做哪个产品”这类长句被关键词误判为 followup。
- 会话层显式维度信号与主判定词表保持一致（含“药品/药物/用药/品规/剂型”）；“药”单字同样走共现护栏，不单独触发产品维度切换。
- 会话层医院显式维度信号已补充 `门诊/机构/诊所`，与主判定保持一致，避免多轮会话中维度漂移。
- `risk_opportunity` 显式维度信号仅接受高置信表达（如“最大风险/最大机会/关键问题/突破口/最值得关注”）；单独“风险/机会”不触发显式维度切换。
- 范围改口径优先视为 `scope override`，不默认等价于 `topic_shift_detected=true`。

与问题判定层关系（本阶段锁定）：

- 本阶段 `sessionState` 只产出承接状态，不直接回写或修正 `questionJudgment`。
- `sessionState` 与 `questionJudgment` 的联合消费留待后续阶段接入。

### 11.7 路由层（Phase 2.4）

后端新增 `routeDecision`（仅请求作用域内可访问），在调用 Gemini 前基于：

- `questionJudgment`（Phase 2.1）
- `dataAvailability`（Phase 2.2）
- `sessionState`（Phase 2.3）

输出 4 类业务路由结果之一：

- `direct_answer`（直接回答）
- `bounded_answer`（带边界回答）
- `refuse`（拒绝/收住）
- `need_more_data`（进入后续补强）

优先级顺序（固定）：

- `refuse -> need_more_data -> bounded_answer -> direct_answer`

判定要点（首版锁定）：

- `need_more_data` 若命中多个条件，会先完整收集全部 `reason_codes`，再一次性返回（不只保留首个原因）。
- `need_more_data` 是内部路由状态，用于进入后续按需调取/补强链路，不是最终用户可见回复类型。
- 命中“全产品问法”且当前仅 `partial` 覆盖时，会进入 `need_more_data`，并记录 `reason_code=product_full_scope_insufficient`。
- 命中“命名产品问法”且 `product_named_support!=full` 时，会进入 `need_more_data`，并记录 `reason_code=product_named_scope_insufficient`。
- 命中“产品×医院交叉问法”且 `product_hospital_support!=full` 时，会进入 `need_more_data`，并记录 `reason_code=product_hospital_scope_insufficient`。
- 当 `detail_request_mode=product_hospital` 时，路由判定主看 `product_hospital_support`，不再以 `product_named_support` 触发 `need_more_data`（两者判据互斥）。
- 命中“命名医院问法”且 `hospital_named_support!=full` 时，会进入 `need_more_data`，并记录 `reason_code=hospital_named_scope_insufficient`。
- 全产品问法关键词已补充：`所有药品/全部药品/所有药/全部药/全药品清单`，与“所有产品/全部产品”同级处理。
- 产品模式优先级固定为：`product_full > product_named > generic`。
- 命名/交叉维度覆盖优先级固定为：`product_full > product_hospital > product_named > hospital_named > generic`。
- 命名产品匹配模式为“精确优先 + 产品族回退”：`exact|family|none`。例如问 `botox` 时可回退命中 `Botox50/Botox100` 同族产品集合。
- `direct_answer` 仅在 `relevance=relevant`、`dimension_availability=available`、`gap_hint_needed=no` 且未命中更高优先级时触发。
- `sessionState` 当前仅在请求作用域内保留并用于观测，路由规则首版不消费其分支影响（后续阶段再接入）。

边界（本阶段）：

- 路由层只负责业务路由决策。
- 不执行按需调取动作（仅产出内部路由状态）。
- 不做最终输出分支动作。
- 不处理 Gemini 上游失败、超时、空回复、格式异常等技术兜底。
- 技术失败继续由后续链路的容错/质量控制逻辑处理。
- `routeDecision` 不注入 prompt、不写响应体、不持久化。

### 11.8 按需调取层（Phase 2.5）

后端新增 `need_more_data` 的内部补强闭环（仅请求作用域内）：

1. 第一段先按既有顺序完成内部判断：  
`questionJudgment -> normalizedBusinessSnapshot -> historyWindow -> sessionState -> dataAvailability -> routeDecision`
2. 仅当 `routeDecision=need_more_data` 时，触发一次后端自动补强（同一请求最多一次）。  
3. 补强目标仅限当前问题主维度（`other` 按 `overall` 兜底），不是补全整份 `business_snapshot`。  
4. 补强窗口绑定 `analysis_range`，并应用最大 24 个月上限。  
5. `analysis_range` 无效时，本次补强跳过；随后按未补强结果继续重判。  
6. 补强后必须重跑 `dataAvailability + routeDecision`。  
7. 若重判后仍不足（仍为 `need_more_data`），最终内部收敛为 `bounded_answer`，不做第二次补强。
8. 医院维度在逐月明细场景会按报表区间生成“逐月 TopN”增强片段：在现有 `hospital_performance` 项内扩展 `monthly_points / monthly_coverage_ratio / monthly_coverage_code`，不新增顶层 schema。
9. 医院维度命中“命名医院问法”时，会优先按命名医院集合补强；简称采用“保守唯一匹配”，多候选不强行绑定。
10. 命中“产品×医院交叉问法”（例如“某产品在哪些医院贡献销量”）时，会优先走医院向补强，并在当前分析窗口内先按命名产品过滤记录，再聚合医院贡献。
11. 产品维度命中“全产品问法”时，会优先基于产品主数据补齐无记录产品（按 `0` 值呈现），并更新 `performance_overview.product_catalog_count_value/product_snapshot_count_value/product_coverage_code`。
12. 产品维度命中“命名产品问法”时，会优先按命名产品集合补强（最多 10 个）；无记录命名产品按 `0` 值呈现并使用中性变化码，不再泛化为“数据不足”中断。
13. 产品全量补强受安全上限控制（首版 `50` 条）；超过上限时覆盖标记为 `partial`，后续由 `bounded_answer` 收敛表达边界。

本阶段边界：

- 不改对外 API 契约，不改前端请求协议。
- 不改 prompt 主链结构，但允许将输入快照替换为补强后的 `business_snapshot`。
- 不新增用户可见字段，不输出内部补强诊断信息。
- 不做多轮代理或无限递归。

### 11.9 输出层（Phase 2.6）

输出层仅处理 3 类最终用户可见回复：

- `direct_answer`
- `bounded_answer`
- `refuse`

说明：

- `need_more_data` 已在 Phase 2.5 内部消化，不属于用户可见输出类型。
- 输出层输入必须使用 Phase 2.5 完成后的最终内部结果（最终 `routeDecision + dataAvailability`）。
- 输出层不重新参与数据判断与补强决策。
- 职责边界：`normalizeOutputReply` 仅做文本归一化；结构性修复（边界句、refuse 示例、内部词清理、重复裁剪）统一由 Phase 2.8 QC 负责。

三类输出约束：

1. `direct_answer`  
先给业务结论，再给依据/分析，必要时补建议；不暴露内部流程与状态名。  
2. `bounded_answer`  
固定顺序为“当前结论 -> 边界说明 -> 可继续深入方向”；必须先结论后边界，不要求用户手动补数据。边界句需命中至少一个提示词：`在当前范围内 / 基于现有信息 / 目前只能 / 暂时无法 / 信息有限 / 口径有限`。  
3. `refuse`  
优先走固定模板回复（不强依赖 Gemini），简洁收住并给 2~3 个可问示例；示例必须是医药销售分析可答问题，且不包含真实客户姓名（可使用代号/产品名/医院代称）。
4. 医院逐月明细（hospital + detail + 逐月请求）  
`direct_answer` 优先按月份组织医院表现要点；`bounded_answer` 先给逐月可得结论，再说明当前逐月覆盖边界。
5. 命名医院问法（hospital + named scope）  
`direct_answer` 优先逐条覆盖被点名医院的结论与依据；`bounded_answer` 先给结论，再说明当前命名医院覆盖边界（不暴露内部过程词）。
6. 全产品问法（product + full scope）  
`direct_answer` 优先覆盖当前可见产品范围并给出关键贡献；`bounded_answer` 需说明当前产品覆盖范围（如受上限或口径影响）。
7. 命名产品问法（product + named scope）  
`direct_answer` 优先逐条覆盖被点名产品结论与依据；若某命名产品无销售记录，使用“本期无销售记录/贡献为0”的业务表达。`bounded_answer` 先结论后边界，说明当前命名产品覆盖范围。
8. 产品×医院交叉问法（product + hospital scope）  
`direct_answer` 优先回答“该产品由哪些医院贡献、贡献结构如何”；当可见医院不少于3家时，至少列出Top3医院贡献点。`bounded_answer` 先给可得医院贡献结论，再说明当前医院覆盖范围边界。

系统与模型分工：

- 系统负责最终输出类型与结构约束。
- 模型负责 `direct_answer / bounded_answer` 的自然表达。
- `refuse` 可由后端模板直接输出。

Prompt 接入方式：

- 输出策略指令通过 `systemInstruction` 追加段落（append）接入，位置在角色定义 `systemInstruction` 之后，优先级高于 user prompt。
- 输出策略不得放入 user prompt。
- 不覆盖已有角色定义、业务边界与“不编造数据”约束。

边界（本阶段）：

- 不改对外响应结构。
- 不新增前端协议字段。
- 不改 UI。
- 不负责技术失败兜底（超时、空回复、上游异常仍走现有错误链路）。

### 11.10 端到端回归与最小观测（Phase 2.7）

目标：

- 验证 Phase 2.1~2.6 全链路顺序：判定 -> 可用性 -> 会话状态 -> 路由 -> 自动补强（可触发）-> 输出层。
- 保证 `need_more_data` 不成为最终用户可见输出类型。
- 在不改对外契约前提下提供最小内部 trace 便于排查。

Trace 规则（仅 server log）：

- 仅在 `DEBUG_TRACE=1` 或 `NODE_ENV!=production` 时输出。
- 仅打印 code/boolean 级字段：`requestId/questionJudgment/dataAvailability(含detail_request_mode/hospital_monthly_support/product_hospital_support/hospital_named_support/product_full_support/product_named_support/product_named_match_mode/requested_product_count_value)/sessionState/routeDecision/retrievalState/outputContext/toolRouteMode/toolRouteType/toolRouteName/toolRouteFallbackReason/forced_bounded/qc(applied+action+reason_codes)`。
- 不打印 token、不打印业务明细、不打印原始 records。
- 不打印 `message` 原文、不打印 `history` 原文。

Trace 输出时机：

- 仅在 Phase 2.5 重判与收敛完成，且 Phase 2.6 `outputContext` 生成完成后，输出一次最终态 trace。

最终路由不变量：

- 正常收敛位置在 Phase 2.5（重判后仍 `need_more_data` 时收敛到 `bounded_answer`）。
- 输出层前增加防御性保护：若最终仍为 `need_more_data`，强制收敛到 `bounded_answer`。
- `forced_bounded=true` 用于标记该兜底；正常情况下此标记应极少出现（Phase 2.5 已应完成收敛）。

`retrievalState` 语义：

- `triggered=true` 表示进入补强入口函数，不等于补强成功。
- `success=true` 表示补强已产出增强片段。

最小 E2E 用例：

1. 无关问题（天气/星座）  
预期：`route=refuse`，输出拒绝模板，不触发补强。
2. 整体摘要（这个月整体怎么样）  
预期：`route=direct_answer` 或 `bounded_answer`；不出现内部过程词。
3. 产品明细（把 Top 产品列出来并说原因）  
预期：可触发补强；最终仅 `direct/bounded`；不出现最终 `need_more_data`。
4. 医院问题（哪家医院最重要）  
预期：医院维度不足时触发补强；最终 `direct/bounded`。
5. 趋势问题（近几个月趋势如何）  
预期：趋势维度不足时触发补强；最终 `direct/bounded`。
6. 承接切题（上轮产品，本轮“那医院呢？”）  
预期：`is_followup=true` 且 `topic_shift_detected=true`，继承项为 `false`，路由按医院维度判定。

窗口绑定专项验收：

- 报表区间 `>24` 个月时，`retrievalState.window_capped=true`。
- 报表区间 `<=24` 个月时，`retrievalState.window_capped=false`。

### 11.11 本地与线上说明

- `npm run dev` 只启动静态站点，不提供 `/api/chat`。
- 聊天功能需在 Cloudflare Pages Functions 环境验证。

### 11.12 最小接口验收（curl）

```bash
curl -sS -X POST "https://<你的-pages-域名>/api/chat" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "message":"请基于当前业务快照给出本月重点推进建议。",
    "business_snapshot":{
      "analysis_range":{"start_month":"2026-01","end_month":"2026-03","period":"2026-01~2026-03"},
      "performance_overview":{
        "sales_amount":"128.50万元",
        "sales_amount_value":1285000,
        "amount_achievement":"92.40%",
        "amount_achievement_ratio":0.924,
        "latest_key_change":"最近月金额环比 +5.20%",
        "latest_key_change_ratio":0.052,
        "latest_key_change_code":"amount_mom",
        "sales_volume":"1850盒",
        "sales_volume_value":1850
      },
      "key_business_signals":["最近月（2026-03）销售额较上月上升，变动+5.20%。","Top1产品阿莫西林贡献销售额42.30万元，占比32.91%。"],
      "product_performance":[
        {
          "product_name":"阿莫西林",
          "product_code":"P001",
          "sales_amount":"42.30万元",
          "sales_amount_value":423000,
          "sales_share":"32.91%",
          "sales_share_ratio":0.3291,
          "change_metric":"金额同比",
          "change_metric_code":"amount_yoy",
          "change_value":"+8.10%",
          "change_value_ratio":0.081
        }
      ],
      "hospital_performance":[],
      "recent_trends":[
        {"period":"2026-01","sales_amount":"38.20万元","sales_amount_value":382000,"amount_mom":"--","amount_mom_ratio":null,"sales_volume":"560盒","sales_volume_value":560},
        {"period":"2026-02","sales_amount":"40.10万元","sales_amount_value":401000,"amount_mom":"+4.97%","amount_mom_ratio":0.0497,"sales_volume":"600盒","sales_volume_value":600},
        {"period":"2026-03","sales_amount":"50.20万元","sales_amount_value":502000,"amount_mom":"+25.19%","amount_mom_ratio":0.2519,"sales_volume":"690盒","sales_volume_value":690}
      ],
      "risk_alerts":[],
      "opportunity_hints":[]
    }
  }'
```

预期：
- 成功返回 `200`，响应包含 `reply`（自然文本）与 `model`。
- 分析类问题会优先返回新的报告流结构化答案，`answer.output_shape=report_flow`，结构包含 `headline / summary / sections / followups`。
- 若未登录或 token 无效，返回 `401 UNAUTHORIZED`。
- 若未配置 `GEMINI_API_KEY`，返回 `500 CONFIG_MISSING`。

### 11.13 质量控制层（Phase 2.8）

位置与目标：

- QC 位于 Phase 2.6 输出层之后、最终 `reply` 写入之前。
- 仅做轻量检测 + 最小修复/兜底，保证最终可见回复稳定。
- 不改 `/api/chat` 请求/响应结构，不新增前端字段，不持久化，不二次调用模型。
- Phase 2.9 不新增层级：它是 Phase 2.6 输出层内的“输出策略指令常量化 + 模板对齐”；Phase 2.8 QC 作为最终防线（内部词、边界句、refuse 示例兜底），两者协同但不引入二次模型调用。

输入与输出（请求内）：

- 输入：最终态 `routeDecision/outputContext` + `modelReplyText`（或 refuse 模板文案）。
- 输出：`finalReplyText` + `qcState{ applied, action, reason_codes }`。
- `qcState` 仅请求内使用；如开启 trace，仅记录 code/boolean。

核心收口规则：

1. `route=refuse` 时不调用 Gemini，直接 `buildRefuseReplyTemplate -> normalizeOutputReply -> QC`。  
2. 内部过程词检测词表集中维护在 `INTERNAL_PROCESS_WORDS`，覆盖中文+英文+内部字段名。  
3. `high_duplication` 固定按 `\n` 与 `。！？；` 切句；比对前做“去空白+去标点”归一化；仅在 `sentenceCount >= QC_HIGH_DUP_SENTENCE_MIN` 时启用。  
4. `irrelevant_refuse_mismatch` 仅强信号触发：  
   - `route!=refuse`：强拒绝词 + 文本长度 `<80`；  
   - `route=refuse`：先忽略“你可以问”示例区，仅对主体拒答语句做判定；主体命中业务证据词 + 句子数 `>=3` 才触发。  
5. findings 分级：  
   - 严重项：`empty_or_too_short`、`irrelevant_refuse_mismatch`；  
   - 非严重项：其余四项。  
6. `safe_fallback` 条件：  
   - 命中任一严重项；或  
   - 非严重项 `>=2` 且执行一次 `minimal_patch` 后复检仍命中 `>=1`。  
7. QC 最多执行“一次 patch + 一次复检”，不做循环改写。  

检测项（6类）：

- `empty_or_too_short`
- `contains_internal_process_words`
- `refuse_missing_examples`
- `bounded_missing_boundary_sentence`
- `high_duplication`
- `irrelevant_refuse_mismatch`

动作（3类）：

- `pass_through`：无问题原样返回。  
- `minimal_patch`：就地补丁（去内部词、补示例、补边界句、去尾部重复）。  
- `safe_fallback`：严重异常或补丁后仍不稳定时，按 route 走最小安全模板。  

### 11.14 Tool-first（当前主路径）

当前聊天后端的主路径已收敛为 `deterministic + AUTO tool-first`：

1. 轻量前置判断只保留两类用途：
   - `relevance=irrelevant` 时直接走现有 `refuse`
   - 时间范围缺失、年份歧义、覆盖不完整时直接走本地 `bounded_answer`
2. 对于相关业务问题，优先使用确定性工具路由或 Gemini `function calling`
3. `legacy fallback` 已降级为应急路径，只有 `CHAT_ENABLE_LEGACY_FALLBACK=1` 时才会启用
4. 默认情况下，tool 路径未形成稳定回答时，服务端返回本地保守边界答复，不再自动回退旧 Phase 2
5. 新增业务语义默认只进入 tool executors；legacy 不再作为主扩展面

V1 首批仅开放 5 类受控业务工具：

- `get_overall_summary`
- `get_product_summary`
- `get_hospital_summary`
- `get_product_hospital_contribution`
- `get_trend_summary`

固定约束：

- 工具默认受当前 `analysis_range` 约束；若命中受支持的时间意图且覆盖完整，则按请求子窗口执行
- 不开放自由 SQL
- 同一请求最多 3 次工具调用、最多 2 轮 tool loop
- `refuse` 仍不调用 Gemini
- tool-first 成功后继续走现有 `normalizeOutputReply + QC`

实现原则：

- 工具执行层优先复用 `domain/report-snapshot.js`、`domain/entity-matchers.js` 以及现有 `infra/*-repository.js`
- 不重新发明第三套统计口径
- `product_full / product_named / hospital_named / product_hospital / hospital_monthly` 的现有成熟匹配规则继续复用，只是从“静态补强优先”迁移为“工具执行器优先”

应急规则：

- 默认不开启 legacy；若 tool-first 未形成稳定回答，直接收敛为本地 `bounded_answer`
- 仅在显式开启 `CHAT_ENABLE_LEGACY_FALLBACK=1` 时，才允许进入 legacy emergency fallback 一次
- 若 tool-first 和 emergency fallback 都失败，仍返回现有结构化错误：`error.code + error.message + requestId`

### 11.15 高置信问题确定性工具路由（Phase T1）

在当前 `deterministic + AUTO tool-first` 主路径之上，系统已新增一层确定性工具路由，用于解决“同一个高置信结构化问题有时调工具、有时不调”的不稳定问题。

固定优先级：

- `product_hospital`
- `hospital_monthly`
- `product_full`
- `hospital_named`

命中后行为：

- 不再进入 Gemini `AUTO function calling`
- 后端直接指定并执行唯一工具
- direct-tool 路径一次只执行 1 个工具，不做二次 tool loop
- direct-tool 成功时，以工具结果作为唯一主事实源，再调用 Gemini 只负责自然语言表达
- direct-tool 失败或 `analysis_range` 无效时，默认回本地保守边界答复；仅在显式开启 legacy emergency fallback 时才进入旧链路

当前纳入确定性工具路由的高置信问法：

- `Botox50在哪些医院贡献最多` -> `get_product_hospital_contribution`
- `botox主要是哪些医院贡献的销量` -> `get_product_hospital_contribution`
- `哪家医院最重要，按近一年逐月说明` -> `get_hospital_summary(include_monthly=true)`
- `分析所有产品表现` -> `get_product_summary(include_all_products=true)`
- `华美这家机构近三个月怎么样` -> `get_hospital_summary`

当前不纳入 T1 的问法：

- 普通整体摘要
- 普通趋势摘要
- 普通命名产品摘要（如“诺和盈1mg怎么样”）

这些问题仍继续走现有 `AUTO tool-first`，避免确定性路由扩范围过大。

输出一致性约束：

- 当 deterministic tool 结果 `coverage=full` 且 `rows>0` 时，最终回答不得写成“数据不足/未提供细分/无法判断”。
- 当 deterministic `product_hospital` 结果 `rows>=3` 时，回复至少体现多家医院，不应只说 Top1。
- 当 deterministic `product_hospital` 结果 `coverage=full` 且 `rows=0` 时，必须明确写成“当前范围内贡献为0/未产生贡献”，而不是“缺数据”。

### 11.16 相对时间意图标准化（Phase T1.1）

当前聊天后端已新增“相对时间意图标准化”层，用于解决“本月 / 近三个月 / 前两个月”被默认解释成报表尾部月份的问题。

固定口径：

- 相对时间默认按真实世界时间解释，不再默认锚定 `analysis_range.end_month`
- 业务时区固定为 `Asia/Shanghai`
- `近N个月 / 前N个月` 默认按完整自然月计算，不包含当前未结束月；`本月` 例外，仍指当前自然月
- 一旦识别到相对或绝对时间意图，系统会先转成绝对时间区间，再与当前 `analysis_range` 做覆盖判定

V1 已支持：

- `本月`
- `上月`
- `近三个月` / `最近三个月`
- `前两个月`
- `今年`
- `去年`
- `本季度`
- `上季度`
- `YYYY-MM`
- `YYYY年M月`
- `YYYY年Qx`

覆盖判定：

- `full`：请求时间区间完全落在当前 `analysis_range` 内，允许继续执行 deterministic tool、AUTO tool-first，必要时才进入 legacy emergency fallback
- `partial`：请求时间区间仅部分落在当前 `analysis_range` 内，不自动裁交集回答，直接进入时间边界说明路径
- `none`：请求时间区间完全不在当前 `analysis_range` 内，不自动改成报表尾部时间，直接进入时间边界说明路径

当前收口规则：

- 若 `time_window_coverage=full`，工具执行使用请求子窗口，而不是整段 `analysis_range`
- 若 `time_window_coverage=partial|none`，不再进入 deterministic tool、AUTO tool-first 或 legacy emergency fallback 业务回答链
- 时间边界回答必须同时写出：
  - 用户请求的真实时间区间
  - 当前可用分析区间
- 不允许把“近三个月 / 本月”偷换成“当前报表最后三个月 / 最后一个月”

输出/QC 约束：

- 只要命中了时间意图，最终回答必须显式写出绝对时间区间
- 若回复把相对时间自动重解释为报表尾部月份，QC 会直接回退到统一时间边界模板

### 11.16.1 裸季度表达与 deterministic 本地降级（Phase T1.2）

在 Phase T1.1 的基础上，当前已继续补齐两类体验问题：

1. `Q4季度销售情况如何` 这类未写年份的裸季度表达
2. deterministic tool 已有有效结果，但 Gemini 上游高负载/超时/上游错误时的本地降级

裸季度表达当前已支持：

- `Q1` / `Q2` / `Q3` / `Q4`
- `Q1季度` / `Q4季度`
- `第一季度` / `第四季度`
- `1季度` / `4季度`

固定解释规则：

- 若 `analysis_range` 为单一年份完整区间（如 `2025-01~2025-12`），则裸季度默认按当前数据年份解释  
  例如：`Q4季度` -> `2025-10~2025-12`
- 若 `analysis_range` 不是单一年份完整区间，则不自动猜年份，直接进入时间边界说明
- 显式年份表达仍优先：`2024年Q4`、`2024年第四季度`

内部补充字段：

- `requested_time_window.anchor_mode = explicit|analysis_year|none`
- `local_response_mode = none|tool_result_fallback|time_boundary`

当前时间边界规则继续保持收口：

- 裸季度命中但无唯一年份锚点时，不进入 deterministic tool、不进入 AUTO tool-first、不进入 legacy emergency fallback 业务回答
- 必须明确说明“用户提到的是未写年份的季度，当前可用区间无法唯一确定所属年份”
- 可补一句“若你希望，我可以按当前报表所在年份的 Q4 来分析”，但不自动替用户选年份

deterministic tool 本地降级规则：

- 仅覆盖 deterministic route，不扩到全部 AUTO tool-first
- 当 deterministic tool 已拿到有效 `toolResult`，但 Gemini 返回：
  - `UPSTREAM_TIMEOUT`
  - `UPSTREAM_ERROR`
  - `UPSTREAM_RATE_LIMIT`
  - `UPSTREAM_NETWORK_ERROR`
- 则优先基于工具结果返回本地模板回答，不再把英文 high demand / upstream error 直接暴露给用户

本地模板约束：

- 必须显式写出绝对时间区间
- 若季度是按当前数据年份锚定出来的，需明确写成：
  - `按当前数据年份口径，这里将 Q4季度 解释为 2025年Q4（2025-10~2025-12）`
- `product_hospital` 在 `rows=0` 时必须明确写“当前范围内该产品医院贡献为0/未产生贡献”
- 本地降级文本仍继续经过 `normalizeOutputReply + QC`

### 11.16.2 整体时间窗口确定性工具路由（Phase T1.3）

在 T1.2 的基础上，当前已把一类高置信“整体/趋势 + 时间窗口”问题纳入 deterministic route，避免这类问题继续落回 `AUTO tool-first`，从而在 Gemini 高负载或超时时出现同题不同答。

当前新增 deterministic route：

- `overall_time_window`

典型问法：

- `Q4季度销售情况如何`
- `本月销售趋势如何`
- `近三个月整体趋势如何`
- `上月整体表现如何`

固定规则：

- 若命中 `requested_time_window.kind !== none` 且主维度为 `overall` 或 `trend`，并且未被更高优先级 deterministic route 抢占，则直接走：
  - `get_overall_summary`
  - 或 `get_trend_summary(dimension="overall")`
- 命中 `overall_time_window` 后，不再进入 Gemini `AUTO function calling`
- direct tool 成功后，最终回答必须以工具结果为主事实源，不再回退成全年汇总口径

输出约束：

- 回答必须显式写出绝对时间区间
- 若季度是按当前数据年份锚定出的，需明确写成：
  - `按当前数据年份口径，这里将 Q4季度 解释为 2025年Q4（2025-10~2025-12）`
- 若已拿到有效整体/趋势结果，不允许再写“数据不足”或把问题重新解释成全年汇总

当前 deterministic local fallback 也已覆盖 `overall_time_window`：

- 若 `overall_time_window` 的 direct tool 已成功拿到有效 `toolResult`
- 但 Gemini 上游返回：
  - `UPSTREAM_TIMEOUT`
  - `UPSTREAM_ERROR`
  - `UPSTREAM_RATE_LIMIT`
  - `UPSTREAM_NETWORK_ERROR`
- 则优先使用本地模板回答：
  - 写清采用的绝对时间区间
  - 给出整体结论
  - 摘要最近月份/季度关键变化
  - 附 1 条简短建议

### 11.17 Legacy Fallback 收敛

- `availability` 已拆为两层：
  - `availability-core.js`：通用判定（`has_business_data / dimension_availability / answer_depth / gap_hint_needed`）
  - `availability-support.js`：模式化支撑解析（`product_full / product_named / hospital_named / product_hospital / hospital_monthly`）
- `routing` 已拆为：
  - `routing-rules.js`：reason code 与优先级决策表
  - `routing.js`：最终 `routeDecision` 组装
- `product_hospital` 与 `product_named` 的 fallback 判据保持互斥；当 `detail_request_mode=product_hospital` 时，路由主看 `product_hospital_support`，不会再被 `product_named_support` 误收敛。
