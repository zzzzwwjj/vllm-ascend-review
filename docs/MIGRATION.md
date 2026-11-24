# 迁移与复刻指南（MIGRATION）

目标：把这套“PR 检视看板”部署到另一个 GitHub 账号 / 仓库，保持同样的自动采集、精读、发布、批注与高优闭环。

## 0. 前置条件

- 一个 GitHub 账号，以及一个用于发布的**公开**仓库（Pages 免费版要求 public）
- 一个 PAT（fine-grained 推荐）：
  - `Public repositories (read-only)`（读上游仓库）
  - 站点仓库权限：`Contents: Read and write`（发布数据 + 网页内“完成检视”直接提交 marks）
  - `Administration: Read and write`（首次自动建仓库）
  - `Pages: Read and write`（开启 Pages）
  - `Issues: Read and write`（批注 / 提醒 / 刷新 / 完成检视的 issue 通道）
  - 或直接使用 classic PAT 勾选 `repo`
- 一台能长期在线、能访问 `api.github.com` 的机器（本方案读写都走 REST API，不需要 git push）
- 一个能跑 LLM Agent 的运行时（本仓库用 DSH）。只用脚本也能跑：会得到采集 + 列表，但没有精读内容

## 1. 复制代码

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

- `user` 必须与 CODEOWNERS 里的 `@handle` 一致
- `site.repo` 建议 `<user>-review-board`（独立站点，不占根域名）
- 上游为私有仓库时，token 需额外具备该仓库读权限

## 3. 放 token

```bash
mkdir -p .secrets && chmod 700 .secrets
printf '%s' '<你的 PAT>' > .secrets/gh_token
chmod 600 .secrets/gh_token
```

`.secrets/` 永不入库、永不发布；`publish.mjs` 会做 token 泄漏扫描。

## 4. 首次采集与发布

```bash
node scripts/collect.mjs        # 首次自动回看最近 3 天
node scripts/split-deep.mjs
# 用 Agent 按 docs/RULES.md 生成 work/reviews/<n>.json（无 Agent 可跳过）
node scripts/render.mjs         # 建库、骨架、搜索索引、文档
node scripts/publish.mjs        # 自动建仓库、开 Pages、发布
```

站点：`https://<user>.github.io/<site.repo>/`。

## 5. 开启 Issues 与标签

用 API 或网页开启 Issues，创建四个标签：

| 标签 | 用途 |
|---|---|
| `review-feedback` | 卡片批注 |
| `review-remind` | 提醒检视（加入高优，不刷新） |
| `review-refresh` | 刷新检视（重新精读并移到最新一期） |
| `review-done` | 完成检视（无 Contents 权限时的 issue 兜底） |

页面内的提交按钮需要有 token（存 localStorage）；未配置则退化为“打开预填 issue”。

## 6. 注册定时任务

在 DSH 中创建 rrule 任务（示例）：

```
DTSTART;TZID=Asia/Shanghai:20260101T080000
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8,13,18;BYMINUTE=0
```

提示词引用 `docs/RUNBOOK.md`（源仓库根目录的 RUNBOOK.md）。也可把同样流程交给 cron + Agent CLI。

## 7. （可选）历史积压

```bash
node scripts/collect-backlog.mjs        # 采集“显式请求我检视、且早于上次运行”的 PR
node scripts/build-backlog-edition.mjs  # 写成首期（backlog: true，只列不精读）
```

采集按时间窗拆分查询，避开 GitHub 搜索 1000 条上限。

## 8. 功能自检清单

- [ ] 首页 200：hero 搜索框 + 功能卡，**无侧栏**；右上角「进入检视列表」可进入批次视图（含侧栏）
- [ ] 首页搜索不存在的 PR 时出现「需要检视」按钮，提交后下一期精读并进入高优
- [ ] 顶部搜索栏滚动时保持固定；可按「编号」和「GitHub ID」检索，未命中给出原因
- [ ] 卡片为「判定色带 + 结论 + 左右两栏（我负责的改动 / 风险）」，两栏等高且可独立滚动
- [ ] 卡片显示总改动量（`+X / −Y · N 个文件`）；文件链接跳到 `blob/<head_sha>/<path>`
- [ ] 文件多时左栏可滚动，滚到边缘继续滚会带动整页
- [ ] 「紧凑模式」切换后保持（localStorage）
- [ ] 「提醒检视」后，侧栏出现「高优检视」批次入口（含色点与待处理数）
- [ ] 「完成检视」直接写入 `data/db/marks.json`，约 1 分钟内状态变为“已检视”
- [ ] 已完成的 PR 从高优检视消失
- [ ] 「刷新检视 / 需要检视」后，该 PR 移到最新一期并进入高优
- [ ] 提交一条 `[feedback]` issue 后，下一期出现批注与“已采纳/未采纳”
- [ ] 连续两期之间没有重复 PR

## 9. 已知限制

- GitHub 搜索单查询最多 1000 条结果，积压采集必须按时间窗拆分
- Pages 对 HTML 有 10 分钟缓存；本项目用“静态骨架 + JSON”规避，内容始终取最新
- 精读质量依赖 Agent 与 `docs/RULES.md`；没有 Agent 时只能得到列表
- 浏览器内直接提交依赖 localStorage 里的 token（需 Contents 写权限）；换设备需重新填写
- 高优检视的“已检视”判定同时看 `marks.json` 与我在该 PR 当前 head 上的 GitHub 检视
