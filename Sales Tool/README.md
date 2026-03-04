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

## 10. 已知边界与后续建议

- 并发冲突策略仍为“最后写入生效”，暂未实现基于 `updated_at` 的乐观锁。
- Excel 导入当前为“分块串行”策略，超大文件导入耗时仍可能较长。
- 当批量写入出现网络/超时等状态不确定异常时，系统不会逐行重试；需刷新页面核对后再决定是否重试。
- 当前缺少自动化测试（仅有语法检查），建议优先补 records/products/targets 的关键路径测试。
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
- 当前阶段仍不注入业务上下文，仅根据用户输入进行自然对话。
- `POST /api/chat` 请求/响应契约保持不变。

### 11.3 业务快照输入层（阶段1.2）

`POST /api/chat` 请求体新增可选字段 `business_snapshot`（向后兼容）：

- `message/mode/history` 兼容保留；
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

首版值格式统一：

- 金额：`xx.xx万元`
- 比例：`xx.xx%`
- 变化：`+xx.xx%` / `-xx.xx%`
- 销量：`xx盒`
- 时间：`YYYY-MM`
- 区间：`YYYY-MM~YYYY-MM`

本阶段边界：

- 不恢复全产品、全医院、全年月明细上下文；
- 不新增复杂风险识别与机会识别逻辑；
- 仅提供最小业务摘要供模型自然回答引用。

### 11.4 本地与线上说明

- `npm run dev` 只启动静态站点，不提供 `/api/chat`。
- 聊天功能需在 Cloudflare Pages Functions 环境验证。

### 11.5 最小接口验收（curl）

```bash
curl -sS -X POST "https://<你的-pages-域名>/api/chat" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "message":"请基于当前业务快照给出本月重点推进建议。",
    "business_snapshot":{
      "analysis_range":{"start_month":"2026-01","end_month":"2026-03","period":"2026-01~2026-03"},
      "performance_overview":{"sales_amount":"128.50万元","amount_achievement":"92.40%","latest_key_change":"最近月金额环比 +5.20%","sales_volume":"1850盒"},
      "key_business_signals":["最近月（2026-03）销售额较上月上升，变动+5.20%。","Top1产品阿莫西林贡献销售额42.30万元，占比32.91%。"],
      "product_performance":[{"product_name":"阿莫西林","product_code":"P001","sales_amount":"42.30万元","sales_share":"32.91%","change_metric":"金额同比","change_value":"+8.10%"}],
      "hospital_performance":[],
      "recent_trends":[{"period":"2026-01","sales_amount":"38.20万元","amount_mom":"--","sales_volume":"560盒"},{"period":"2026-02","sales_amount":"40.10万元","amount_mom":"+4.97%","sales_volume":"600盒"},{"period":"2026-03","sales_amount":"50.20万元","amount_mom":"+25.19%","sales_volume":"690盒"}],
      "risk_alerts":[],
      "opportunity_hints":[]
    }
  }'
```

预期：
- 成功返回 `200`，响应包含 `reply`（自然文本）与 `model`。
- 若未登录或 token 无效，返回 `401 UNAUTHORIZED`。
- 若未配置 `GEMINI_API_KEY`，返回 `500 CONFIG_MISSING`。
