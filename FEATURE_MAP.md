> 讀法：揀嘢前查 ｜ 內容：功能到檔案對位 ｜ 上限：30KB

# FEATURE_MAP

| Capability | Source of truth | Generated/runtime output | Gate |
|---|---|---|---|
| Supported locale (it) and metadata | `scripts/locales.mjs` | `lib/client.js` language list | `scripts/check.mjs` |
| Translation dictionary | `src/en`, `src/it` | `lib/client.js` DICTS | `npm run i18n:check` |
| Upstream extraction | Installed DSH client bundles | `src/en`, `src/zh-src` | Extractor fails on missing/changed bundles |
| English fallback | `scripts/assemble.mjs` (`locale.translate` wrapper) | Missing `it` keys show English | `verify-runtime.mjs` |
| Auto-translate (client) | `scripts/assemble.mjs` (MT observer, `DOM_SKIP_SELECTOR`) | Long English DOM text → `/api/dsh-i18n.translate` | `verify-runtime.mjs` |
| Auto-translate (host) | `index.mjs` (`Config`, cache, `ctx.llm.stream`) | Fetch route `/api/dsh-i18n.translate` | — |
| Untranslated-English detection | `scripts/check.mjs` `englishWordCount` | — | `npm run i18n:check` |
| Package release metadata | `package.json`, `cordis.patch.yml` | ModuleLoader id = package name | `verify-runtime.mjs` |
| Host version contract | `package.json` `engines` + `peerDependencies` | — | `npm run verify:peers` |
