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
├── main.js                    # 应用启动、状态装配、云端数据访问封装
├── auth.js                    # 认证门禁、会话保持、注册/登录/退出
├── storage.js                 # 本地存储与数据规范化工具
├── products.js                # 产品维护与销售录入校验
├── records.js                 # 记录列表、多选、导入、云端读写
├── targets.js                 # 指标录入、分配、校验
├── reports.js                 # 报表计算、图表渲染、导出
├── config.example.js          # Supabase 配置模板
├── config.js                  # 运行时配置（构建生成，已 gitignore）
├── dist/                      # Cloudflare Pages 静态产物目录（构建生成，已 gitignore）
├── scripts/
│   ├── generate-config.js     # 按环境变量生成 config.js（本地）
│   └── build-pages.js         # 生成 dist/ 并写入 dist/config.js（部署）
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

> `npm run dev` 仅提供静态页面，不包含 Cloudflare Pages Functions；`/api/chat` 需在 Pages Functions 环境验证。

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

`main.js` 会挂载一个 smoke 方法：
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
9. 聊天接口错误提示可区分：`UNAUTHORIZED(401)` / `CONFIG_MISSING` / `AUTH_UPSTREAM_TIMEOUT(504)` / `UPSTREAM_TIMEOUT(504)` / `UPSTREAM_AUTH_ERROR` / `UPSTREAM_RATE_LIMIT` / `UPSTREAM_ERROR`。

## 10. 已知边界与后续建议

- 并发冲突策略仍为“最后写入生效”，暂未实现基于 `updated_at` 的乐观锁。
- Excel 导入当前为“分块串行”策略，超大文件导入耗时仍可能较长。
- 当批量写入出现网络/超时等状态不确定异常时，系统不会逐行重试；需刷新页面核对后再决定是否重试。
- 当前缺少自动化测试（仅有语法检查），建议优先补 records/products/targets 的关键路径测试。
- 当导入后的产品同步失败时，系统会提示并尝试回拉云端产品；已写入的 records 不会回滚。

## 11. AI 分析指标层（阶段1）

当前已补充“确定性指标与口径层”，用于后续 AI Chatbot 消费，不直接接入模型。

### 数据来源与口径
- 数据来源：`state.reportRecords`（全量报表记录）+ `sales_targets` 映射能力。
- 默认分析区间：跟随报表区间（`reportStartYm ~ reportEndYm`）。
- 指标优先级：金额优先（销量作为补充证据）。
- 口径计算复用 `reports.js` 的 `buildReportSnapshot`，避免重复算法导致口径漂移。

### 对外能力（开发态桥接）
`main.js` 已挂载：
- `window.__SALES_TOOL_ANALYTICS__.buildContext(rangeOverride?)`
- `window.__SALES_TOOL_ANALYTICS__.kpi(rangeOverride?)`
- `window.__SALES_TOOL_ANALYTICS__.trends(rangeOverride?)`
- `window.__SALES_TOOL_ANALYTICS__.products(rangeOverride?, options?)`
- `window.__SALES_TOOL_ANALYTICS__.hospitals(rangeOverride?, options?)`
- `window.__SALES_TOOL_ANALYTICS__.risks(rangeOverride?, options?)`
- `window.__SALES_TOOL_ANALYTICS__.outline(rangeOverride?)`

说明：
- `rangeOverride` 形如 `{ startYm: "2026-01", endYm: "2026-12" }`。
- 未传 `rangeOverride` 时，默认使用页面当前报表区间。

### 阶段1默认阈值
- 波动预警：`|金额环比| >= 20%`
- 低达成预警：`金额达成率 < 80%`
- 高贡献对象：`金额占比 >= 10%`
- 默认 Top：`5`

## 12. Gemini 接入与 Cloudflare 部署（步骤版）

本项目采用 **Cloudflare Pages + Pages Functions** 方式接 Gemini。  
核心原则：`GEMINI_API_KEY` 只放服务端 Secret，不进入前端 `config.js`。

### 12.1 Cloudflare Pages 配置
1. 打开 `Workers & Pages` -> 你的 Pages 项目。
2. `Settings` -> `Builds & deployments`，确认：
   - Root directory: `Sales Tool`
   - Build command: `npm ci && npm run build:cf`
   - Build output directory: `dist`
3. `Settings` -> `Environment variables`（Production / Preview）：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. `Settings` -> `Variables and Secrets`：
   - Secret: `GEMINI_API_KEY`
   - Variable: `GEMINI_MODEL=gemini-2.5-flash`
5. 确认 `GEMINI_API_KEY` 已保存到 **Production** 环境，且值无引号、无前后空格；保存后执行一次 Redeploy。

### 12.1.1 Gemini 连通性硬校验（推荐）
在 Cloudflare 部署后，先直接调用线上 `/api/chat`（带登录态 Token）验证链路，再回到 UI 验收：

```bash
curl -sS -X POST "https://<你的-pages-域名>/api/chat" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "message":"请用中文回复“连通正常”",
    "context":{"kpi":{},"risk":{},"outline":{}},
    "mode":"briefing",
    "stream": false
  }'
```

如果返回 `UPSTREAM_AUTH_ERROR`，优先检查 Cloudflare `GEMINI_API_KEY` 与 Google AI Studio 配额/权限。

### 12.2 后端接口说明
本仓库已新增 Pages Function：
- `POST /api/chat`（文件：`functions/api/chat.js`）

请求头要求：
- `Authorization: Bearer <Supabase access token>`
- 缺少或无效 Token 时返回 `401`（`UNAUTHORIZED`）。

响应追踪：
- 所有 `POST /api/chat` 响应都会返回 `x-request-id` 响应头。
- 响应体也会返回同一个 `requestId`，用于前后端统一排查。

请求体：
```json
{
  "message": "用户问题",
  "context": {
    "kpi": {},
    "trend": {},
    "product": {},
    "hospital": {},
    "risk": {},
    "outline": {}
  },
  "history": [
    { "role": "user", "content": "上次你给我的简报结论是什么？" },
    { "role": "assistant", "content": "上次结论为：整体销售微增但达成率未达标。" }
  ],
  "mode": "briefing",
  "stream": false
}
```

`mode` 可选值：
- `briefing`：简报模式（结论+亮点+风险+动作）
- `diagnosis`：诊断模式（异常定位+原因假设+影响范围）
- `action-plan`：行动模式（执行清单+负责人+时间+追踪指标）

结构化生成策略：
- 服务端通过 `responseMimeType: application/json` + `responseSchema` 约束 Gemini 输出。
- 首轮输出仅在 `json_parse_failed/output_truncated` 时才进入 retry；`schema_invalid` 不默认重试（减少无效二次调用）。
- 若首轮 + 纠错重试后仍为 `json_parse_failed/output_truncated`，会触发一次“结构化修复调用”。
- 对 `schema_invalid`：仅 `diagnosis/action-plan` 在满足 `elapsedAfterRetry < 22000ms` 且 `outputChars >= 300` 时才允许进入 repair；`briefing` 不放开，避免时延继续抬升。
- 分阶段预算保护：总预算 `35000ms`；`first >= 18000ms` 时不再进入 retry，`first+retry >= 24000ms` 时不再进入 repair。
- 按 mode 动态 token（并按问题长度上下浮动 1 档）：
  - `briefing`: first `1024` / retry `1408`
  - `diagnosis`: first `1280` / retry `1792`
  - `action-plan`: first `1536` / retry `2048`
- Gemini 上游超时：`30000ms`；登录态校验超时仍为 `12000ms`。
- 结构化质量门槛（mode 化）：
  - `briefing`：`summary>=70`，`highlights>=1`，`evidence>=1`，`actions>=1`
  - `diagnosis`：`summary>=60`，`highlights>=1`，`evidence>=1`，`actions>=0`
  - `action-plan`：`summary>=60`，`highlights>=0`，`evidence>=1`，`actions>=1`
- mode 化 schema required（字段全集保留，按 mode 下调必填）：
  - `briefing`：`summary/highlights/evidence/risks/actions`
  - `diagnosis`：`summary/highlights/evidence/risks`
  - `action-plan`：`summary/evidence/actions`
  - `nextQuestions` 为可选字段（前端兼容读取）
- mode 化输出体量约束（用于减少截断）：
  - `briefing`：`highlights/evidence/risks/actions/nextQuestions` 各建议不超过 2 条
  - `diagnosis`：`highlights<=2,evidence<=3,risks<=2,actions<=1,nextQuestions<=1`
  - `action-plan`：`actions<=3,evidence<=3,risks<=1,highlights<=1,nextQuestions<=1`
  - 统一约束：宁可少条目，也要一次输出完整 JSON，避免超长句子
- 会话历史门槛：最多携带最近 4 轮（8 条）`history`，总字符上限约 `2000`。
- 上下文瘦身策略（按模式）：
  - 每种 mode 至少保留：`overviewMetric`（总览指标）+ `trendOverview`（趋势信息）+ `keyEvidence`（关键证据）
  - `briefing`：基础字段 + `trend.items` Top 1
  - `diagnosis`：`trend.items` Top 2（摘要与建议做长度截断）
  - `action-plan`：`trend.items` Top 1 + `product/hospital` Top 2（evidence 精简为 1 条）

非流式成功响应（`stream=false`，默认）：
```json
{
  "reply": "结构化摘要文本（兼容旧前端）",
  "model": "gemini-2.5-flash",
  "requestId": "...",
  "mode": "briefing",
  "format": "structured",
  "meta": {
    "formatReason": "structured_ok",
    "retryCount": 0,
    "finishReason": "STOP",
    "outputChars": 386,
    "repairApplied": false,
    "repairSucceeded": false,
    "attemptCount": 1,
    "totalDurationMs": 8421,
    "stageDurations": { "first": 8421, "retry": 0, "repair": 0 },
    "finalStage": "first",
    "contextChars": 2521,
    "historyChars": 864,
    "attemptDiagnostics": [
      {
        "stage": "first",
        "format": "structured",
        "formatReason": "structured_ok",
        "finishReason": "STOP",
        "outputChars": 386,
        "elapsedMs": 8421,
        "maxOutputTokens": 896
      }
    ]
  },
  "structured": {
    "summary": "总体结论",
    "highlights": ["亮点1", "亮点2"],
    "evidence": [
      { "label": "区间销售额", "value": "123456.78", "insight": "较上期回升" }
    ],
    "risks": ["风险1"],
    "actions": [
      { "title": "动作1", "owner": "销售A", "timeline": "下周", "metric": "达成率" }
    ],
    "nextQuestions": ["下次需要补充哪些数据？"]
  }
}
```

流式响应（`stream=true`）：
- 响应头：`content-type: application/x-ndjson`
- 逐行事件（每行一条 JSON）：
```json
{ "type": "start", "requestId": "...", "mode": "briefing" }
{ "type": "thinking", "requestId": "...", "message": "AI 思考中..." }
{ "type": "delta", "requestId": "...", "text": "正在生成的文本片段" }
{ "type": "done", "requestId": "...", "reply": "...", "model": "gemini-2.5-flash", "mode": "briefing", "format": "structured", "structured": { "...": "..." }, "meta": { "...": "..." } }
```
- 失败事件：
```json
{ "type": "error", "requestId": "...", "error": { "code": "UPSTREAM_TIMEOUT", "message": "Gemini 请求超时（>30000ms），请稍后重试。" } }
```

结构化回退说明：
- 当模型输出无法解析为有效 JSON、字段不完整或输出截断时，接口返回 `format: "text_fallback"`。
- 此时 `structured` 为 `null`，`reply` 返回模型原始文本（或服务端兜底提示）。
- `meta.formatReason` 用于定位回退原因，可取值：
  - `structured_ok`
  - `json_parse_failed`
  - `schema_invalid`
  - `output_truncated`
  - `empty_reply`
- `meta.repairApplied` 表示本次是否触发了修复调用。
- `meta.repairSucceeded` 表示修复调用是否成功恢复结构化结果。
- `meta.attemptCount` 表示总尝试次数（首轮 + 重试 + 修复）。
- `meta.totalDurationMs` 为本次请求端到端处理耗时（服务端）。
- `meta.stageDurations` 为分阶段耗时（`first/retry/repair`）。
- `meta.finalStage` 为最终命中的阶段。
- `meta.contextChars/historyChars` 用于观察请求体体量。
- `meta.attemptDiagnostics` 为按阶段记录的尝试诊断数组（`stage/format/formatReason/finishReason/outputChars/elapsedMs/maxOutputTokens`），用于定位“首轮命中低”或“repair 依赖高”。

失败响应（示例）：
```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "Gemini 请求超时（>30000ms），请稍后重试。",
    "stage": "retry",
    "upstreamStatus": 503,
    "durationMs": 30012
  },
  "requestId": "..."
}
```

### 12.3 前端接线说明
- `main.js` 在初始化后会调用 `window.__SALES_TOOL_AI_CHAT__.setSendHandler(...)`。
- 发送消息前会自动组装阶段1指标上下文，并携带当前模式调用 `/api/chat`，默认 `stream=false`（稳态优先）。
- 前端会在内存中维护最近 6 轮会话历史用于 UI 连续性，但请求透传会裁剪为最多 4 轮（8 条，2000 字符）。
- 仅当显式传入 `stream=true` 时才走流式增量渲染；流式失败时前端不会再发起二次补发请求。
- 发送后会先显示 `AI 思考中...` 占位消息（带三点动画），随后按 `delta` 事件逐步更新文本。
- 若 Functions 未部署或 Secret 缺失，聊天区会显示明确中文错误（错误态会附带请求号）。
- 当 `format = text_fallback` 时，前端会显示“文本回退”状态提示（含 `requestId + formatReason`）。
- 仅在 `formatReason` 为 `json_parse_failed/output_truncated` 且 `repairSucceeded=false` 时，前端才提示“结构化输出未完成，请重试”。
- 若连续失败达到阈值，发送按钮会短暂冷却：
  - 连续失败 2 次：冷却 3 秒
  - 连续失败 3 次及以上：冷却 5 秒
  - 成功一次后失败计数清零
- 错误提示会附带诊断片段（如 `阶段: retry, 上游: 503`），便于快速排障。
- 默认用户态不展示“耗时/阶段/attemptCount”；仅开发态优先显示：
  - `localhost/127.0.0.1` 自动显示
  - 或控制台设置 `window.__SALES_TOOL_CHAT_DEBUG__ = true`
- 本地 `npm run dev` 不提供 `/api/chat`，需部署到 Cloudflare Pages Functions 才能联通 Gemini。
- AI 聊天头部支持模式切换：`简报 / 诊断 / 行动`。
- 调试桥接：
  - `window.__SALES_TOOL_AI_CHAT__.getSessionHistory()`
  - `window.__SALES_TOOL_AI_CHAT__.clearSessionHistory()`

### 12.4 验收清单
1. 线上页面登录后可正常使用业务模块。
2. 发送聊天问题可返回 Gemini 文本。
3. 前端源码与 `config.js` 中不包含 `GEMINI_API_KEY`。
4. 关闭或清空 `GEMINI_API_KEY` 时，聊天提示“服务端未配置”。
5. 错误码可区分：`UNAUTHORIZED(401)`、`CONFIG_MISSING`、`AUTH_UPSTREAM_TIMEOUT(504)`、`UPSTREAM_TIMEOUT(504)`、`UPSTREAM_AUTH_ERROR`、`UPSTREAM_RATE_LIMIT`、`UPSTREAM_ERROR`。
6. 用户报错时可提供“请求号（requestId）”用于排查。
7. 错误响应中可见 `error.stage/upstreamStatus/durationMs`（如上游 503 位于 retry 阶段）。
8. 切换不同模式发送时，请求体 `mode` 与当前按钮一致。
9. `format: structured` 时渲染结构化卡片；`format: text_fallback` 时自动回退文本显示。
10. `meta.formatReason/retryCount/finishReason/outputChars/repairApplied/repairSucceeded/attemptCount/totalDurationMs/stageDurations/finalStage/contextChars/historyChars/attemptDiagnostics` 在响应中存在且可用于排障。
11. 流式场景下，发送后 300ms 内可见 `AI 思考中...`，并按 `delta` 事件逐步显示文本。

### 12.5 Supabase 权限核查
1. `products` / `sales_records` / `sales_targets` 三张表开启 RLS。
2. 策略基于 `auth.uid()` 隔离用户数据。
3. 前端只使用 anon key，禁止 `service_role` 出现在客户端或仓库。

### 12.6 稳态压测（10 次连续提问）
为快速验证“止血改动”是否生效，提供脚本化压测命令：

```bash
CHAT_API_ENDPOINT="https://<你的-pages-域名>/api/chat" \
CHAT_AUTH_TOKEN="<SUPABASE_ACCESS_TOKEN>" \
npm run check:chat-stability
```

可选参数：
- `--delayMs 4000`：请求间隔（默认 4000ms）
- `--stream false`：默认走非流式稳态路径

脚本会自动执行固定 10 次请求（`briefing*4 / diagnosis*3 / action-plan*3`），输出：
1. Markdown 明细表（含 `requestId/HTTP/error.code/stage/upstreamStatus/durationMs/format/attemptCount/repairApplied/finalStage/elapsedMs`）
2. `finalStage` 总体占比（`first/retry/repair`）
3. 按 mode 统计（`attemptCount=3` 占比、`text_fallback` 占比、`finalStage=first/retry/repair` 占比、`p95 elapsedMs`）
4. `attemptDiagnostics.formatReason` 分布（overall + by mode，分别输出 `first/retry` 的 top reasons，含 `unknown_source` 兜底标记）
5. 重点指标摘要（`structured` 占比、`finalStage=first` 占比、`text_fallback by mode`、`first/retry top formatReason`）
6. 总体耗时统计（`p50/p95 elapsedMs`）
7. 与 baseline 对比（固定基线：`p50=30815`, `p95=45849`, `structured=50%`, `attempt3=40%`, `briefing repair=100%`, `diagnosis fallback=66.7%`, `action-plan fallback=100%`）
8. 阈值判定（Pass/Fail）：
   - 总失败率 `<= 20%`
   - `UPSTREAM_TIMEOUT` 占比 `<= 10%`
   - `attemptCount=3` 占比 `<= 30%`
   - `structured` 占比 `>= 60%`
   - `p95 elapsedMs <= 15000ms`（目标值）
9. 自动日志判读建议（基于错误码与阶段）

注意：
- 该脚本是接口压测，不依赖浏览器 UI；不会覆盖“前端冷却按钮”的人工体验检查。
- 当 `p95` 落在 `15000~18000ms` 区间时，脚本会输出详细耗时分布，默认进入“温和优化”而非激进降质。
- 若命令返回 exit code `2`，代表压测完成但至少一个阈值未达标。
