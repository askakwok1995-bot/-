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
- Excel 导入按行写入云端 records。
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
├── scripts/
│   └── generate-config.js     # 按环境变量生成 config.js
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
npm run build:cf
```

### 启动本地服务
```bash
npm run dev
```
默认地址：`http://localhost:5173`

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
- Build output directory：`.`
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
- Excel 导入按行串行写入，超大文件导入耗时会明显增加。
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
   - Build output directory: `.`
3. `Settings` -> `Environment variables`（Production / Preview）：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. `Settings` -> `Variables and Secrets`：
   - Secret: `GEMINI_API_KEY`
   - Variable: `GEMINI_MODEL=gemini-2.5-flash`

### 12.2 后端接口说明
本仓库已新增 Pages Function：
- `POST /api/chat`（文件：`functions/api/chat.js`）

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
  "mode": "briefing"
}
```

成功响应：
```json
{
  "reply": "模型回复文本",
  "model": "gemini-2.5-flash",
  "requestId": "..."
}
```

### 12.3 前端接线说明
- `main.js` 在初始化后会调用 `window.__SALES_TOOL_AI_CHAT__.setSendHandler(...)`。
- 发送消息前会自动组装阶段1指标上下文并调用 `/api/chat`。
- 若 Functions 未部署或 Secret 缺失，聊天区会显示明确中文错误。

### 12.4 验收清单
1. 线上页面登录后可正常使用业务模块。
2. 发送聊天问题可返回 Gemini 文本。
3. 前端源码与 `config.js` 中不包含 `GEMINI_API_KEY`。
4. 关闭或清空 `GEMINI_API_KEY` 时，聊天提示“服务端未配置”。

### 12.5 Supabase 权限核查
1. `products` / `sales_records` / `sales_targets` 三张表开启 RLS。
2. 策略基于 `auth.uid()` 隔离用户数据。
3. 前端只使用 anon key，禁止 `service_role` 出现在客户端或仓库。
