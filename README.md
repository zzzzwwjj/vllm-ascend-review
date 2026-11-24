# vLLM-Ascend 待我检视

自动生成的 PR 检视看板，服务于 [@zzzzwwjj](https://github.com/zzzzwwjj) 在 [vllm-project/vllm-ascend](https://github.com/vllm-project/vllm-ascend) `.github/CODEOWNERS` 中负责的路径。

- 站点：https://zzzzwwjj.github.io/vllm-ascend-review/
- 更新：每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai）
- 口径：显式请求我检视、且从未在往期出现过的 PR；只对 CODEOWNERS 中我负责的文件做重点分析

## 存储（`data/db/`）

数据与页面分离，页面只负责查询与渲染：

| 文件 | 内容 |
|---|---|
| `manifest.json` | 期次列表、期次版本、分片版本与条数 |
| `editions/<期号>.json` | 单期元数据 + 成员及角色（deep / rest）；历史期次可能带 `legacy_html` |
| `prs/<千位>.json` | 以 PR 为主记录，含元数据与精读结果；按编号分片 |
| `feedback.json` | 网页批注 |
| `lessons.json` | 从批注蒸馏出的检视规则 |

页面打开任意一期时：读 manifest → 读该期 edition → 按成员编号读取对应分片 → 渲染。
旧链接 `runs/<期号>.html` 会自动跳转到 `?e=<期号>`。

数据源：GitHub REST API（公开信息）。
