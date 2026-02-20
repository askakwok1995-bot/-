# 前端工程化冲刺练习项目

## 项目简介
这是一个面向零基础学习者的单页前端练习项目，使用原生 `HTML + CSS + JavaScript` 实现。  
项目目标是把“会写页面”升级为“会维护、会调试、会发布”的小应用。

## 功能清单
1. 语义化单页结构（学习路线、练习区、版本日志）。
2. 导航锚点跳转 + 滚动高亮（含无障碍与降级处理）。
3. 表单校验（必填、范围、步长、即时提示）。
4. 草稿自动保存/恢复（`learningFormDraft.v1`）。
5. 打卡记录本地持久化（`learningCheckins.v1`）。
6. 打卡记录支持筛选、行内编辑、删除。
7. 打卡记录支持同步模式切换：
   - 本地模式：完全使用本地存储。
   - 远程模式：请求 JSONPlaceholder；失败自动回退本地。
8. 明确数据状态提示（`loading / error / empty`）。
9. 模态框无障碍交互（Esc 关闭、Tab 焦点陷阱、焦点恢复）。

## 使用方式
1. 直接双击打开 `/Users/askakwok/Documents/Vibe Coding/Practice/index.html`。
2. 或使用本地静态服务（推荐，便于后续调试）：

```bash
cd "/Users/askakwok/Documents/Vibe Coding/Practice"
python3 -m http.server 5500
```

然后访问：`http://localhost:5500`

## 远程模式说明（JSONPlaceholder）
1. 远程接口地址：`https://jsonplaceholder.typicode.com/posts`
2. 切到“远程模式”时会尝试加载远程记录。
3. 远程失败时会自动切回本地模式，并显示状态提示。
4. “重试远程加载”按钮可再次尝试远程请求。

## 已知问题
1. JSONPlaceholder 是练习 API，数据不是真实持久化数据库。
2. 远程返回的数据结构与本地打卡结构不同，项目中做了映射转换。
3. 在完全离线环境下，远程模式会自动回退本地模式。

## 下一步计划
1. 增加分页与排序（按日期/状态）。
2. 增加批量操作（批量删除、批量状态更新）。
3. 为编辑流程加入键盘快捷键（Enter 保存、Esc 取消）。
4. 把 JS 拆分为模块文件（在保持教学注释的前提下逐步工程化）。

## GitHub Pages 发布步骤（默认方案）
1. 初始化并提交代码：

```bash
cd "/Users/askakwok/Documents/Vibe Coding/Practice"
git init
git add .
git commit -m "feat: front-end engineering sprint baseline"
```

2. 在 GitHub 创建同名仓库后，关联远程并推送：

```bash
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```

3. 打开 GitHub 仓库设置：
   - `Settings` -> `Pages`
   - `Source` 选择 `Deploy from a branch`
   - Branch 选择 `main`，目录选择 `/ (root)`
4. 保存后等待 1-3 分钟，GitHub 会生成公开访问链接。
