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
│   ├── ingest-feedback.mjs     收录批注 / 提醒 / 刷新 issue
│   ├── apply-refresh.mjs       应用一次“重新精读”结果并迁移期次
│   ├── render.mjs              写入数据库 + 骨架 + 资产
│   ├── publish.mjs             单次提交发布到 GitHub Pages
│   ├── build-search-index.mjs  生成全局搜索索引
│   ├── db-query.mjs            命令行查库
│   ├── collect-prs.mjs         按编号采集若干 PR（刷新/重建用）
│   ├── collect-backlog.mjs     历史积压采集（一次性）
│   └── build-backlog-edition.mjs 把积压写成首期（一次性）
├── state/                      state.json / feedback / lessons / highlights / published
└── out/                        发布产物（data/db、app.js、app.css、index.html）
```

## 2. 一期的标准流程

```bash
cd /workspace/project/vllm-ascend-review
rm -rf work/reviews && mkdir -p work/reviews
node scripts/collect.mjs            # 采集：CODEOWNERS、搜索、去重、排序
node scripts/ingest-feedback.mjs    # 收录批注 / 提醒 / 刷新
# 若有 work/refresh.json：逐条精读并应用
#   node scripts/collect-prs.mjs --numbers <pr>
#   子代理按 RULES 精读 -> work/reviews/<pr>.json
#   node scripts/apply-refresh.mjs --pr <pr>
node scripts/split-deep.mjs         # 本期 Top20 精读输入（如有）
# 子代理写 work/reviews/<n>.json
node scripts/render.mjs             # 写库 + 骨架 + 搜索索引 + 文档
node scripts/publish.mjs            # 单次提交
```

## 3. 定时任务

- 每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai），`FREQ=WEEKLY;BYDAY=MO..FR;BYHOUR=8,13,18`
- 窗口 = 上次成功发布到本次运行；首次或间隔 >3 天截断为最近 3 天
- 只有 `publish.mjs` 成功后才推进 `state.last_run_at`

## 4. 发布机制

- `publish.mjs` 用 Git Data API 把所有变更合并成**一次提交**，只触发一次 Pages 构建；
- `state/published.json` 记录文件 sha256，未变更文件跳过；`--force` 可强制重传；
- 数据按 `data/db/prs/<千位>.json` 分片，带 `?v=<hash>` 版本，浏览器可长期缓存；
- Pages 要求仓库 public（免费计划），站点地址 `https://<user>.github.io/<repo>/`。

## 5. 权限与配额

- PAT：fine-grained（Public repos read + 目标仓库 Contents/Administration/Pages RW + Issues RW）
  或 classic `repo`；
- API 配额 5000/小时；单期约 300–900 次调用；搜索接口结果上限 1000（积压按时间窗拆分）；
- 页面内提交需要用户在浏览器里填一个仅限本仓库 Issues 读写的 fine-grained token（存 localStorage）。

## 6. 故障排查

| 现象 | 排查 |
|---|---|
| 页面“加载中”不动 | `data/db/manifest.json` 能否 200；`app.js` 是否被缓存（硬刷） |
| 某一期缺数据 | `data/db/editions/<id>.json` 在否；manifest 里 `v` 是否更新 |
| 新 PR 不出现 | 是否在 `state.prs`（历史已见）；是否 draft；是否请求了我；`updated_at` 是否在窗口内 |
| CODEOWNERS 不生效 | 看运行日志 `CODEOWNERS sha=… rules=… mine=…`；拉取失败会直接终止 |
| Pages 构建失败 | 多为并发提交；publish 已是单提交，重试一次即可 |
| 搜索查不到 | 搜索只覆盖库内已出现的 PR；合入/关闭的不在库内则查不到 |
| token 失效 | 页面“GitHub 已连接”变红或提交报 401；重新填写 |

## 7. 状态与恢复

- `state/state.json`：`last_run_at`、`runs`、`prs`（去重主键，约 1100 条）
- `state/feedback.json` / `lessons.json` / `highlights.json`：批注、规则、高优列表
- 若本地 `state/editions.json` 丢失，`collect.mjs` 会从线上 `data/db/manifest.json` 恢复期次列表；
  `state.prs` 丢失则无法恢复去重历史（新 PR 会重复出现一次），需从 `data/db` 重建。
