# 迁移与复刻指南（MIGRATION）

目标：把这套“PR 检视看板”部署到另一个 GitHub 账号 / 仓库，保持同样的自动采集、精读、发布与批注闭环。

## 0. 前置条件

- 一个 GitHub 账号，以及一个用于发布的**公开**仓库（Pages 免费版要求 public）
- 一个 PAT：
  - fine-grained：`Public repositories (read-only)` + 目标站点仓库的 `Contents: RW`、`Administration: RW`、`Pages: RW`、`Issues: RW`；
  - 或 classic：勾选 `repo`
- 一台能长期在线、能访问 `api.github.com` 的机器（本方案所有读写都走 REST API，
  不需要 `git clone/push`；若你的网络能直连 github.com，也可以自行替换为 git 流程）
- 一个能跑 LLM Agent 的运行时（本仓库用 DSH）。**只用脚本也能跑**：会得到采集+列表，
  但没有“精读”内容——精读由 Agent 按 `RULES.md` 生成 `work/reviews/<n>.json`。

## 1. 复制代码

把本仓库（脚本 + docs + config.json 模板）复制到你自己的环境：

```bash
git clone <this-repo> my-review-board   # 或直接拷贝目录
cd my-review-board
```

## 2. 改配置 `config.json`

```json
{
  "user": "<你的 GitHub 登录名>",
  "repo": { "owner": "<上游 owner>", "name": "<上游仓库>" },
  "site": { "repo": "<站点仓库名>", "branch": "main", "language": "zh" },
  "window": { "maxDays": 3 },
  "deepReview": { "topN": 20 },
  "filters": { "excludeDrafts": true },
  "scan": { "maxCandidates": 250, "concurrency": 10 }
}
```

- `user` 必须与 CODEOWNERS 里的 `@handle` 一致（大小写不敏感，但拼接 token 时要用真实登录名）
- `site.repo` 建议 `<user>-review-board` 或 `<user>.github.io`（后者会占用站点根）
- 若上游是私有仓库，需要 token 具备该仓库读权限

## 3. 放 token

```bash
mkdir -p .secrets && chmod 700 .secrets
printf '%s' '<你的 PAT>' > .secrets/gh_token
chmod 600 .secrets/gh_token
```

`.secrets/` 永不入库、永不发布；`publish.mjs` 会做 token 泄漏扫描。

## 4. 建站点仓库并开启 Pages

`publish.mjs` 会在第一次运行时自动创建 `<user>/<site.repo>`（public，auto_init），
并开启 Pages（source: `main` / `/`）。若仓库已存在则复用。

## 5. 首次采集与发布

```bash
node scripts/collect.mjs        # 首次会自动回看最近 3 天
node scripts/split-deep.mjs
# 用 Agent 按 RULES.md 生成 work/reviews/<n>.json（没有 Agent 可跳过）
node scripts/render.mjs
node scripts/publish.mjs
```

首次发布会写入 `data/db/`、`app.js`、`app.css`、`index.html`。站点地址：
`https://<user>.github.io/<site.repo>/`。

## 6. 开启 Issues 与标签（批注 / 高优动作需要）

用 API 或网页开启 Issues，并创建标签：

- `review-feedback`（批注）
- `review-remind`（提醒检视）
- `review-refresh`（刷新检视）

页面内提交按钮会要求你在浏览器里填一个仅限该仓库 Issues 读写的 token（存在 localStorage）；
不填则退化为“新标签打开预填 issue”，手动点 Submit。

## 7. 注册定时任务

在 DSH 中创建 rrule 任务（示例见 `docs/OPERATIONS.md`）：

```
DTSTART;TZID=Asia/Shanghai:20260101T080000
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8,13,18;BYMINUTE=0
```

任务提示词直接引用 `docs/RUNBOOK.md` 的步骤；也可以把同样的流程交给 cron + Agent CLI。

## 8. （可选）历史积压

如果要从零接管一堆存量 PR：

```bash
node scripts/collect-backlog.mjs        # 采集“显式请求我检视、且早于上次运行”的 PR
node scripts/build-backlog-edition.mjs  # 写成首期（backlog: true，只列不精读）
```

注意：采集脚本会按时间窗拆分查询，避开 GitHub 搜索 1000 条上限。

## 9. 验收清单

- [ ] `https://<user>.github.io/<repo>/` 200，能看到最新一期
- [ ] 切换历史期次正常，侧栏条目齐全
- [ ] 顶部搜索能按编号 / GitHub ID 命中，未命中给出解释
- [ ] 卡片文件链接能跳到 `blob/<head_sha>/<path>`
- [ ] 提交一条 `[feedback]` issue 后，下一期出现批注与“已采纳/未采纳”
- [ ] 点“提醒检视”后，左侧出现“高优检视”
- [ ] 点“刷新检视/需要检视”后，该 PR 移到最新一期并进入高优列表
- [ ] 连续两期之间没有重复 PR（`state.prs` 去重生效）

## 10. 已知限制

- GitHub 搜索单查询最多 1000 条结果，积压类采集必须按时间窗拆分
- Pages 对 HTML 有 10 分钟缓存；本项目用“静态骨架 + JSON”规避，页面内容始终取最新
- 精读质量依赖 Agent 与 `docs/RULES.md`；没有 Agent 时只能得到列表
- 浏览器内提交依赖用户在 localStorage 里保存 token，换设备需重新填写
