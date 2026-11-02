<!--
投稿新站点？先看 CONTRIBUTING.md 的「加一个新站点」。只想推荐、不想改代码的话，开 Issue 填表单更省事。
-->
- [ ] 只改了源文件：`data/sites.json`（以及 `scripts/` 等手写文件）
- [ ] **没有**带上 `README.md`、`README.en.md`、`docs/`、`data/live.json`、`data/history.json`、`data/changelog.json`——它们是生成物，CI 每 6 小时重写一次，带上几小时内就会冲突；合并后 CI 会自动探测并生成
- [ ] 新站点写了 `en` 覆盖块（README.en.md 里对应段落才不会缺）
- [ ] 本地跑过 `npm test` 和 `npm run build`
- [ ] 如果要下架站点：不要直接删，在 `data/sites.json` 里给它加 `archived: { at, reason }`，历史区会保留记录
