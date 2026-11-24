# vLLM-Ascend 待我检视

自动生成的 PR 检视看板，服务于 [@zzzzwwjj](https://github.com/zzzzwwjj) 在 [vllm-project/vllm-ascend](https://github.com/vllm-project/vllm-ascend) `.github/CODEOWNERS` 中负责的路径。

- 站点：https://zzzzwwjj.github.io/vllm-ascend-review/
- 更新：每个工作日 08:00 / 13:00 / 18:00（Asia/Shanghai）
- 口径：显式请求我检视、且从未在往期出现过的 PR；只对 CODEOWNERS 中我负责的文件做重点分析
- 存储：`data/db/` 是以 PR 为主记录的库（manifest / editions / prs 分片 / feedback / lessons），页面只负责查询与呈现
- 页面：静态骨架 + 客户端查库渲染，`?e=<期号>` 查看任意一期
- 数据源：GitHub REST API（公开信息）
