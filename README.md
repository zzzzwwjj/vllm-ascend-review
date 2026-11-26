# vLLM-Ascend 待我检视

自动生成的 PR 检视看板，服务于 [@zzzzwwjj](https://github.com/zzzzwwjj) 在 [vllm-project/vllm-ascend](https://github.com/vllm-project/vllm-ascend) `.github/CODEOWNERS` 中负责的路径。

- 站点：https://zzzzwwjj.github.io/vllm-ascend-review/
- 更新：每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai）
- 口径：显式请求我检视、且从未在往期出现过的 PR；只对 CODEOWNERS 中我负责的文件做重点分析

## 页面能力

- 顶部**固定搜索栏**：按 PR 编号或 GitHub ID 检索，未命中会说明可能原因
- 精读卡片：判定色带 + 结论 + 左右两栏（我负责的改动 / 风险），两栏等高、各自可滚动
- 无责任田文件的 PR 只做**简单检视**（标 `简单检视`），深入部分由对应 code owner 负责
- 卡片显示 PR 的目标分支（如 `→ main`），也可按分支筛选
- 卡片与列表标注 PR 状态（进行中 / 待合入 / 有冲突 / CI 未过 / 待评审 / 待更新 / 草稿 / 已关闭 / 已合入），卡片上边缘颜色随状态
- 侧栏按状态统计每期分布，悬停可看完整明细；绿蓝红只统计未合入/未关闭/非草稿的 PR
- **筛选**：全局「全部 PR」页与每个期次页都支持按 PR 状态、检视状态、精读结论、目标分支、高优、责任田、检视方式、CI、变更规模、有无讨论筛选；条件写入 URL，可分享
- 首页可直接填写 token 后操作；顶部标题与底部文档链接指向 GitHub 仓库
- 卡片显示总改动量（`+X / −Y · N 个文件`）、文件链接直达 `blob/<head_sha>/<path>`
- **紧凑模式**开关（localStorage 记忆）：一屏可扫完一期
- 卡片操作：**提醒检视**、**刷新检视**、**完成检视**（直接写入 `data/db/marks.json`）
- 高优检视：侧栏一个批次入口，含待处理数与绿蓝红三色点；已完成/已检视的自动移出
- 精读对照上游 `.github/agent-review` 的 L1/L2 规则，卡片展示引用的规则 ID
- 回复：卡片下方可写回复；@zzzzwwjj 的回复会蒸馏为检视规则，其他作者的回复会得到回应并视情况刷新精读

## 存储（`data/db/`）

| 文件 | 内容 |
|---|---|
| `manifest.json` | 期次列表、期次版本、分片版本 |
| `editions/<期号>.json` | 单期元数据 + 成员角色（deep / rest） |
| `prs/<千位>.json` | PR 元数据（检索 / 列表 / 状态，主键 PR 编号） |
| `prs/detail/<千位>.json` | PR 精读详情（打开卡片时才下载） |
| `feedback.json` / `lessons.json` | 批注与蒸馏出的检视规则 |
| `highlights.json` | 高优检视（已过滤完成项，含结论） |
| `marks.json` | 完成检视标记（浏览器直接提交，发布前合并） |
| `search.json` | 全局搜索索引 |

页面打开任意一期：读 manifest → 读该期 edition → 按成员编号读对应分片 → 渲染。
旧链接 `runs/<期号>.html` 会自动跳转到 `?e=<期号>`。

## 文档

- [规则与口径](docs/RULES.md)
- [运维手册](docs/OPERATIONS.md)
- [迁移复刻](docs/MIGRATION.md)

数据源：GitHub REST API（公开信息）。
