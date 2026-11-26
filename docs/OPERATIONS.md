# 运维手册（OPERATIONS）

## 1. 目录与文件

```
vllm-ascend-review/
├── config.json                 账号、仓库、站点、窗口、精读参数
├── .secrets/gh_token           PAT（600，不入库、不发布）
├── scripts/
│   ├── collect.mjs             采集 + 去重 + 排序（每期入口）
│   ├── split-deep.mjs          拆分精读输入
│   ├── fetch-file.mjs          取 head 处文件内容
│   ├── fetch-agent-review.mjs  同步上游 .github/agent-review 检视知识库
│   ├── refresh-states.mjs      刷新所有 PR 状态（open/draft/closed/merged，GraphQL 批量）
│   ├── sync-review-status.mjs  把我在 GitHub 上的检视同步为 marks（并与请求时间比较）
│   ├── refresh-edition-stats.mjs 重算各期状态统计与结论色点（排除已合入/关闭/草稿）
│   ├── merge-threads.mjs       合并同一 PR 的重复 issue（无 token 用户造成）
│   ├── ingest-feedback.mjs     处理每 PR 一个 issue 的评论线程（动作/批注/回复）
│   ├── reply-feedback.mjs      把回应写回看板并回复 issue
│   ├── apply-review-update.mjs 原地更新某 PR 的精读结论
│   ├── apply-refresh.mjs       应用一次“重新精读”结果并迁移期次
│   ├── render.mjs              写库 + 合并远端 marks + 骨架 + 搜索索引 + 文档
│   ├── publish.mjs             单次提交发布到 GitHub Pages
│   ├── build-search-index.mjs  生成全局搜索索引
│   ├── backfill-head-sha.mjs   补全历史记录的 head_sha（文件链接用）
│   ├── db-query.mjs            命令行查库
│   ├── collect-prs.mjs         按编号采集若干 PR（刷新/重建用）
│   ├── collect-backlog.mjs     历史积压采集（一次性）
│   └── build-backlog-edition.mjs 把积压写成首期（一次性）
├── docs/                       RULES / OPERATIONS / MIGRATION（发布时复制到站点）
├── state/                      state.json / feedback / lessons / highlights / marks / published
└── out/                        发布产物（data/db、app.js、app.css、index.html、docs）
```

### 一次性脚本（历史迁移用，正常流程不需要）

| 脚本 | 用途 |
|---|---|
| `migrate-legacy.mjs` | 把骨架化之前的旧期次 HTML 转成数据 JSON |
| `db-migrate.mjs` | 把按期次 JSON 迁成规范化库（prs 分片 + editions + manifest） |
| `rebuild-plan.mjs` / `apply-rebuild.mjs` | 按“只保留首次出现”的规则重算历史期次（先算计划，再应用） |
| `backfill-head-sha.mjs` | 给旧记录补 `head_sha`，让文件链接能指向具体提交 |

## 2. 一期的标准流程

```bash
cd /workspace/project/vllm-ascend-review
rm -rf work/reviews && mkdir -p work/reviews
node scripts/fetch-agent-review.mjs  # 同步上游检视规则（L1/L2 清单）
node scripts/refresh-states.mjs     # 先刷新 PR 状态（决定按钮可用性与请求是否受理）
node scripts/sync-review-status.mjs # 同步我在 GitHub 上的检视状态（早于请求则视为未检视）
node scripts/refresh-edition-stats.mjs # 重算期次状态统计与色点
node scripts/merge-threads.mjs      # 合并重复 issue（无 token 用户会新建 issue）
node scripts/ingest-feedback.mjs    # 处理 issue 评论线程（动作/批注/回复，决定本期优先级）
node scripts/collect.mjs            # 采集：CODEOWNERS、搜索、去重、请求优先排序
node scripts/split-deep.mjs         # 拆分本期精读输入（请求 PR + 新增 PR）
# 子代理写 work/reviews/<n>.json
node scripts/render.mjs             # 合并远端 marks、写库（meta/detail）、骨架、文档
node scripts/build-search-index.mjs # 重建检索索引（含状态/检视/结论等筛选字段）
node scripts/publish.mjs            # 单次提交
```

## 3. 定时任务

- 每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai），`FREQ=WEEKLY;BYDAY=MO..FR;BYHOUR=8,13,18`
- 窗口 = 上次成功发布到本次运行，**不设上限**（节假日长间隔也全量覆盖）；首次运行回看 `window.maxDays` 天；搜索按天切片，已在 `state.prs` 的 PR 不产生额外调用
- 只有 `publish.mjs` 成功后才推进 `state.last_run_at`

## 4. 数据文件（`data/db/`）

| 文件 | 内容 | 谁写 |
|---|---|---|
| `manifest.json` | 期次列表、期次版本、分片版本 | render |
| `editions/<期号>.json` | 单期元数据 + 成员角色（deep/rest） | render / apply-refresh |
| `prs/<千位>.json` | PR 元数据（检索/列表/状态，主键 PR 编号） | render / apply-* |
| `prs/detail/<千位>.json` | PR 精读详情（打开卡片时才加载） | render / apply-review-update / apply-refresh |
| `feedback.json` | 批注及其采纳结论 | render（源自 state） |
| `lessons.json` | 从批注蒸馏的规则 | render |
| `highlights.json` | 高优检视（已过滤完成项，含结论 `v`） | render |
| `marks.json` | 完成检视标记 | 浏览器直接提交，render 发布前合并 |
| `search.json` | 检索与筛选索引（n/t/a/e/r/v/s/d/m/o/c/z/u） | build-search-index |

## 5. 发布机制

- 页面默认进入**首页**（hero 搜索 + 功能卡，无侧栏；右上角进入批次视图）；`?e=` 看期次、`?pr=` / `?author=` 看单条/作者、`?hl=1` 看高优；
- `publish.mjs` 用 Git Data API 把所有变更合并成**一次提交**，只触发一次 Pages 构建；
- `state/published.json` 记录文件 sha256，未变更文件跳过；`--force` 可强制重传；
- 分片带 `?v=<hash>` 版本，浏览器可长期缓存；
- 页面是“静态骨架 + 客户端查库”，HTML 只有 ~600 字节，内容永远取最新。

## 6. 权限与配额

- PAT：fine-grained（Public repos read + 站点仓库 `Contents: RW`、`Administration: RW`、`Pages: RW`、`Issues: RW`）或 classic `repo`；
- **Contents 写权限**是“完成检视直接提交 marks.json”的前提；只给 Issues 时会退回 issue 方式；
- API 配额 5000/小时；单期约 300–900 次调用；搜索接口结果上限 1000（积压按时间窗拆分）。

## 7. 故障排查

| 现象 | 排查 |
|---|---|
| 页面“加载中”不动 | `data/db/manifest.json` 能否 200；`app.js` 是否被缓存（硬刷） |
| 某一期缺数据 | `data/db/editions/<id>.json` 在否；manifest 里 `v` 是否更新 |
| 新 PR 不出现 | 是否在 `state.prs`（历史已见）；是否 draft；是否请求了我；`updated_at` 是否在窗口内 |
| CODEOWNERS 不生效 | 看日志 `CODEOWNERS sha=… rules=… mine=…`；拉取失败会直接终止 |
| Pages 构建失败 | 多为并发提交；publish 已是单提交，重试一次即可 |
| 搜索查不到 | 数字会尝试直接读分片；作者搜索只覆盖库内已出现的 PR |
| 「完成检视」一直“待同步” | 看仓库是否出现 `chore: mark PR #n as reviewed`；有则是页面缓存，硬刷即可（已做加载对账） |
| 完成检视提示“仅限本人操作” | 没有填 token，或 token 属于其他账号；只有 `@zzzzwwjj` 的 token 可用（不回退 issue） |
| 完成检视提示权限不足 | token 缺 `Contents: RW`，换成本人且带该权限的 token |
| token 失效 | 重新填写；页面“GitHub 已连接”会提示 401 |

## 8. 状态与恢复

- `state/state.json`：`last_run_at`、`runs`、`prs`（去重主键，约 1100 条）
- `state/feedback.json` / `lessons.json` / `highlights.json` / `marks.json`
- `state/processed-comments.json`：已处理的 issue 评论 id（线程去重靠它）
- 若本地 `state/editions.json` 丢失，`collect.mjs` 会从线上 `data/db/manifest.json` 恢复期次列表；
  `state.prs` 丢失则无法恢复去重历史（新 PR 会重复出现一次），需从 `data/db` 重建；
  `state/marks.json` 丢失也不要紧，`render.mjs` 会从线上 `data/db/marks.json` 合并回来。
