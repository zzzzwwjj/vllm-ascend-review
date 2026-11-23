# vLLM-Ascend 待我检视

自动生成的 PR 检视看板，服务于 [@zzzzwwjj](https://github.com/zzzzwwjj) 在 [vllm-project/vllm-ascend](https://github.com/vllm-project/vllm-ascend) `.github/CODEOWNERS` 中负责的路径。

- 站点：https://zzzzwwjj.github.io/vllm-ascend-review/
- 更新：每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai）
- 口径：显式请求我检视、且我尚未在当前提交上给出结论的 PR；只对 CODEOWNERS 中我负责的文件做重点分析
- 架构：`index.html` 是固定骨架，页面内容全部在加载时从 `data/` 读取；每期只新增 `data/runs/<期号>.json`
- 历史：`?e=<期号>` 查看任意一期，侧栏始终同步最新列表
- 数据源：GitHub REST API（公开信息）
