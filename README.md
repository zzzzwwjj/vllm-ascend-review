# vLLM-Ascend 待我检视

自动生成的 PR 检视看板，服务于 [@zzzzwwjj](https://github.com/zzzzwwjj) 在 [vllm-project/vllm-ascend](https://github.com/vllm-project/vllm-ascend) `.github/CODEOWNERS` 中负责的路径。

- 站点：https://zzzzwwjj.github.io/vllm-ascend-review/
- 更新：每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai）
- 口径：显式请求我检视、且从未在往期出现过的 PR；只对 CODEOWNERS 中我负责的文件做重点分析

## 文档

- [规则与口径](docs/RULES.md)：什么进入范围、去重、精读规则、批注闭环、高优动作
- [运维手册](docs/OPERATIONS.md)：目录、脚本、发布机制、配额、故障排查
- [迁移复刻](docs/MIGRATION.md)：把同样的看板部署到你自己的账号

## 存储（`data/db/`）

| 文件 | 内容 |
|---|---|
| `manifest.json` | 期次列表、期次版本、分片版本与条数 |
| `editions/<期号>.json` | 单期元数据 + 成员及角色（deep / rest） |
| `prs/<千位>.json` | 以 PR 为主记录，含元数据与精读结果 |
| `feedback.json` / `lessons.json` | 批注与从批注蒸馏出的规则 |
| `highlights.json` | 高优检视（提醒 / 已刷新） |
| `search.json` | 全局搜索索引 |

页面打开任意一期：读 manifest → 读该期 edition → 按成员编号读对应分片 → 渲染。
旧链接 `runs/<期号>.html` 会自动跳转到 `?e=<期号>`。
