# 检视规则与口径（RULES）

本文件固化看板的判定口径，任何一次定时任务都应遵循；口径变更请直接改这里。

## 1. 服务对象

- 账号：`zzzzwwjj`
- 上游仓库：`vllm-project/vllm-ascend`
- 责任田：以仓库 `.github/CODEOWNERS` 为准（`@zzzzwwjj` 出现的规则）

## 2. 什么进入检视范围

采集只有一条查询：`is:pr is:open review-requested:zzzzwwjj updated:>=上次运行`。

之所以够用，是因为：

- 分支保护强制 code owner 检视 → 改了我负责的文件时 GitHub 会自动把我加进 reviewer；
- 这次 push 会刷新 `updated_at`，落在窗口内；
- 人工“请求我 review”也会刷新 `updated_at`（已实测）。

## 3. 去重规则（严格）

**只要 PR 在 `state.prs` 里出现过，就永不再进入新一期**，无论是否精读、head 是否变化。

- 被过滤的数量记在 `stats.skipped_seen`（页头“历史已见”）；
- 草稿、我自己的 PR、我已给结论的 PR 记在 `stats.skipped_other`（“其他过滤”）；
- 草稿不写入 `state.prs`，转正式后仍算新 PR，会重新出现。

## 4. 精读规则

- 每期精读数 = min(20, 本期新增数)，不足 20 不补历史；
- 只重点分析 PR 中落在责任田内的文件；其余文件只统计数量；
- 精读必须基于 head 真实代码核对，不得臆造；把握不足时 `confidence=low` 并写明要作者确认什么；
- 结论三档：`approve`（可批准）/ `look`（需细看）/ `pushback`（建议打回）；
- 风险分 `high / medium / low`，只写具体风险，不写套话。

## 5. 历史积压期

首期（`2026-11-23-0015`）是历史积压，不是某一轮增量：

- 范围：尚未合入、待我检视、且不在近四期、也不是上次运行之后新增的 PR；
- 只列不精读，`backlog: true`、`label: "历史积压"`；
- 构建脚本：`collect-backlog.mjs` + `build-backlog-edition.mjs`。

## 6. CODEOWNERS 变更

- 每期重新拉取，无缓存；拉取失败或解析为 0 条规则时终止本期；
- 不做哈希对比、不做变更提示、不回溯历史期次；
- 缩小责任田：历史只会多覆盖，不会漏；扩大责任田：相关 PR 在下次 push/请求时被带出。

## 7. 批注与规则学习

- 每张精读卡片可提交批注，落成 `[feedback]` issue；
- 每期收录后：写回 `state/feedback.json`（含采纳/未采纳结论），蒸馏 1–3 条规则进 `state/lessons.json`；
- 规则要泛化、≤80 字、总量 ≤15 条；精读时最多注入 10 条与改动路径相关的规则。

## 8. 高优动作

- **提醒检视**：`[remind]` issue → 只加入左侧“高优检视”，不做其他动作；
- **刷新检视 / 需要检视**：`[refresh]` issue → 重新精读该 PR；完成后从原批次移除、加入最新一期，
  并进入“高优检视”。实现见 `OPERATIONS.md`。

## 9. 数据不可变

已发布的期次内容不回溯修改（除一次性的积压替换与去重重算）。补丁类修正只作用于最新一期。
