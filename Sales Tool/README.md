# 医药代表销售汇报工具（当前阶段）

一个基于原生 `HTML + CSS + JavaScript` 的前端项目，用于医药销售录入、列表管理、指标维护与报表分析。

当前版本已接入 Supabase 认证和销售记录表（`public.sales_records`）的核心读写流程，并保留 localStorage 作为缓存/回退层。

## 1. 当前能力总览

### 已完成
- 强制登录门禁（未登录不可操作业务区）。
- 认证方式：邮箱 + 密码（支持注册、登录、退出）。
- 登录后显示当前邮箱，支持退出。
- 销售记录 `records` 已完成云端最小闭环：
  - 初始化读取（按当前用户从 Supabase 拉取）
  - 新增（先写云端，再写本地）
  - 单条删除（先删云端，再改本地）
  - 批量删除（支持部分成功提示）
  - 清空全部（先删云端，再清本地）
  - 行内编辑保存（先更新云端，再改本地）
- 切换账号后自动刷新页面，避免串号显示。
- records 本地缓存按账号隔离：`sales_records_v1:<user_id>`。
- 产品配置、指标录入、报表分析可正常工作。
- 报表表格与图表支持导出（XLSX/PNG，视模块而定）。

### 仍是本地逻辑（未云端化）
- 产品主数据（products）
- 指标数据（targets）
- 报表偏好与参数（时间范围、配色、金额单位等）
- Excel 导入写入的 records（当前仅写本地 state/localStorage）

## 2. 技术栈与依赖

- 前端：原生 JavaScript（ES Module）
- 图表：`ECharts`（本地 `vendor/echarts.min.js`）
- Excel 读写：`xlsx` + `exceljs`（本地 `vendor/`）
- 认证与数据库：`@supabase/supabase-js`（CDN）
- 本地开发服务：`http-server`

> 运行方式必须是 `http://`，不能 `file://` 直开。页面内置了直开拦截提示。

## 3. 目录结构

```text
/Users/askakwok/Documents/Vibe Coding/Sales Tool
├── index.html                 # 页面结构与脚本入口
├── styles.css                 # 全站样式（含认证模态/报表/指标/列表）
├── main.js                    # 启动流程、全局状态、模块装配、Supabase records CRUD 封装
├── auth.js                    # 认证门禁、会话保持、注册/登录/退出、账号切换处理
├── storage.js                 # localStorage 读写与数据规范化工具
├── products.js                # 产品配置与销售录入校验逻辑
├── records.js                 # 记录列表、分页排序、多选、导入、云端读写对接
├── targets.js                 # 年度/季度/月度指标与产品分配
├── reports.js                 # 报表计算、图表渲染、导出
├── config.example.js          # Supabase 配置模板
├── config.local.js            # 本地配置（已 gitignore）
├── .gitignore
├── package.json
├── package-lock.json
└── vendor/
    ├── echarts.min.js
    ├── xlsx.full.min.js
    └── exceljs.min.js
```

## 4. 运行与检查

### 安装依赖
```bash
npm install
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

## 5. 配置说明（Supabase）

项目通过 `window.__APP_CONFIG__` 注入配置（`index.html` 会先加载 `config.local.js`）。

`config.local.js` 结构：

```js
window.__APP_CONFIG__ = {
  SUPABASE_URL: "https://<your-project-ref>.supabase.co",
  SUPABASE_ANON_KEY: "<your-anon-or-publishable-key>",
};
```

注意事项：
- `config.local.js` 已被 `.gitignore` 忽略，不应提交。
- 若缺少配置，登录按钮会被禁用并显示配置错误。

## 6. 认证与门禁流程

1. 页面启动先执行 `bootstrapAuthGate()`。
2. 未登录：显示认证模态、锁定主界面。 
3. 已登录：关闭模态，展示“已登录邮箱 + 退出按钮”，再初始化业务模块。 
4. 退出登录：立即恢复锁定态。 
5. 如果检测到“新登录用户 ID 与上次不同”，会自动 `reload` 以重建状态。

认证相关对外接口（`auth.js`）：
- `bootstrapAuthGate(domRefs)`
- `getCurrentAuthUser()`
- `getSupabaseClient()`
- `signOutAuth()`

## 7. records 与 Supabase 的当前数据流

表：`public.sales_records`

### 字段映射（当前实现）
- `user_id` ← 当前登录用户 `id`
- `record_date` ← `date`
- `hospital_name` ← `hospital`
- `product_name` ← `productName`
- `purchase_quantity_boxes` ← `quantity`
- `assessed_amount` ← `amount`
- `channel` ← `delivery`
- `actual_amount` / `remark`：当前写入 `null`

### 行为策略
- 新增/删/改均为“云端成功后再更新本地”。
- 云端读取失败时，提示并保留本地缓存。
- 账号隔离：所有云端查询均带 `user_id` 过滤；本地缓存 key 也按用户隔离。

## 8. localStorage 键（当前）

- `sales_product_master_v1`
- `sales_records_v1`（历史全局键，当前 records 流程已改为按用户键）
- `sales_records_v1:<user_id>`（当前 records 使用）
- `sales_targets_v1`
- `sales_form_draft_v1`
- `sales_report_range_v1`
- `sales_report_chart_palette_v1`
- `sales_report_chart_data_label_v1`
- `sales_report_amount_unit_v1`

## 9. 调试能力（开发期）

`main.js` 会挂一个 smoke 方法到全局：

- `window.__SALES_TOOL_SUPABASE_SMOKE_WRITE__(options)`

用途：插入一条测试记录并回读（可选自动清理），用于快速验证 Supabase 写链路。

## 10. 手动验收建议（当前版本）

1. 打开页面，未登录时业务区不可操作。  
2. 注册新账号或用已有账号登录成功，模态关闭。  
3. 新增一条记录，刷新后仍存在（云端读写成功）。  
4. 单删/批删/清空全部后刷新，结果保持一致。  
5. 编辑一条记录并保存，刷新后保持。  
6. 切换到另一个账号，不应看到上个账号记录。  
7. 退出登录后回到锁定态。  
8. 执行 `npm run check` 通过。  

## 11. 已知边界与后续建议

- 目前仅 records 核心流程已云端化；products/targets/reports 仍以本地为主。 
- Excel 导入尚未写入 Supabase，导入后数据仅本地可见。 
- 暂未做 records 的并发冲突控制（例如基于 `updated_at` 的乐观锁）。

可优先推进：
1. 导入记录云端化（含批量错误回执）。
2. 产品与指标数据上云并做按用户隔离。
3. 增加基础自动化测试（至少覆盖 records 云端 CRUD 主路径）。
