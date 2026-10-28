> 讀法：開工必讀 ｜ 內容：目前狀態、驗證與下一步 ｜ 上限：50KB

# HANDOFF

## Current state
- 2026-10-28: **0.3.1** — fixes from the old `report_GLM.md` review (4 Oct, written for the 20-locale repo; the rest of it no longer applies):
  - Host (`index.mjs`): `/api/dsh-i18n.translate` rejects payloads over 48 texts, texts that are not non-empty strings ≤ 4000 chars, and `targetLang` that is not a non-empty string ≤ 64 chars (`invalidTranslatePayload`, exported). With `autoTranslate: false` it no longer coerces non-strings.
  - Client auto-translate (`scripts/assemble.mjs`): each translated Text node remembers `{ original, translated }`; switching away from `it` restores the English text. Its own Italian output is no longer re-sent to the model (before, every re-walk sent it again and produced "IT:IT:…" chains). LRU cap of 1000 entries, no duplicate requests for texts in flight, failed texts retried twice after 2 s, post-response walk coalesced into one rAF.
  - `verify-runtime.mjs` derives the expected key count from `src/en` and now drives auto-translate through a mock DOM, timers and RPC (translate, no self re-send, restore, cache reuse, in-flight dedup, bounded retry). The old bundle fails 5 of these checks.
  - `extract.mjs` warns about installed packages that call `locale.register` but are missing from `PKGS`.
  - `index.d.ts` declares `Config` (interface + schema) and `apply(ctx, config)`.
  - `npm test` EXIT=0; host validation checked separately against the real `@deepseek-ai/schemastery` / `dsh-llm` (12 cases). Not GUI-verified.
- 2026-10-26: **Split from `gradia64/dsh-i18n` (branch `gradia-local` at `6d1b87c`) into `gradia64/dsh-i18n-it`, Italian only.** Package `@gradia64/dsh-i18n-it` `0.3.0`; git history kept. See DECISIONS 2026-10-26.
  - Removed: the 19 other locales in `src/`, the zh-HK/zh-TW Simplified→Traditional converter (`src/zh-tw-parts`, `fill-traditional`, `collect-chars`, `check-missing-chars`, `verify-converter`), the Simplified-residue gate, RTL handling, `verify-dicts.mjs`, `verify/` (Python checks), 20 translated READMEs, `registry-entry.yml`, `src/TERMINOLOGY.md` (zh-TW glossary).
  - Kept: `src/en` + `src/zh-src` (extraction baseline / en fallback), `src/it`, `extract.mjs`, `migrate-locales.mjs`, `check.mjs`, `verify-peers.mjs`, host `index.mjs` unchanged.
  - Internal ids unchanged on purpose: cordis id `dsh-i18n`, `/api/dsh-i18n.translate`, localStorage `dsh-i18n.preference` / `dsh-i18n.mt`, cache `~/.cache/dsh-i18n/`. The chosen language and the translation cache survive the switch; the old and new packages must not be installed together.
  - `lib/client.js`: 2.98 MB → 178 KB. npm pack: 8 files, 59.8 kB.
  - `scripts/pending-translation.json`: 6 entries, all intentional English (app name, URLs, example ids, protocol name).
  - `npm test` EXIT=0 (verify:peers + i18n check + build + runtime harness).
  - 2026-10-26: GUI-verified by the owner: `@gradia64/dsh-i18n` removed, `github:gradia64/dsh-i18n-it` installed on Desktop, Italian UI works.
- DSH coverage: dictionaries extracted from **0.2.1-rc.3** (54 packages, 2910 keys); `engines.dsh` `>=0.1.1-rc.2 <0.3.0-0`.

## Next
- Nothing pending. On the next DSH release follow "Updating for a new DSH release" below.

## Updating for a new DSH release
1. Install the new `@deepseek-ai/dsh` (`npm install --ignore-scripts`) somewhere outside the repo.
2. `node scripts/extract.mjs <path>` (it warns about unlisted packages with dictionaries) → `node scripts/migrate-locales.mjs` → translate the new keys in `src/it/` → `node scripts/check.mjs --record-pending` → `npm test` (the expected key count follows `src/en`).
3. Check `dsh-llm`, `dsh-client-locale`, `dsh-client-connection`, `dsh-app-boot` for API changes and that `DOM_SKIP_SELECTOR` attributes still exist upstream; widen `engines.dsh` / peers (and `verify-peers.mjs`) for a new minor line.

## Italian terminology
Steer→"Indirizza", Queue→"Accoda", job→"job", workspace→"spazio di lavoro", preset→"preset", subagent→"subagente", Auto review→"Revisione automatica", Discover→"Scopri", plugin market→"marketplace di plugin", index source→"sorgente dell'indice", automation task→"attività automatica", reminder→"promemoria", registry→"registry", sidebar→"barra laterale", conversation view→"vista conversazione". Keep app/product names, URLs, slash-command tokens and units in English.

## Gotchas
- `__ModuleLoader__.load({ id })` must equal `package.json` name; `assemble.mjs` derives it and `verify-runtime.mjs` checks it. `cordis.patch.yml` `name` must be changed by hand on a rename.
- `PKGS` in `scripts/extract.mjs` is a hand-written allowlist: a missing package silently drops its strings.
- Always pass `--profile` (read `%APPDATA%/DSH Desktop/profile-selection/state.json` `active`); the `web` shim installs into `web` and Desktop never loads it.
- Community Market accepts only an exact published npm version; GitHub specs install only via `dsh plugin add`.
- Isolated Host RPC times out at 120s if MCP servers stall; launch with `DSH_DESKTOP_ISOLATED_HOST=0` when that happens.
- Earlier multi-locale history (0.1.x → 0.2.8-gradia.5) is in git log and in `gradia64/dsh-i18n` (archived 2026-10-26, read-only).

## 文件地圖
| File | Read method | Purpose |
|---|---|---|
| HANDOFF.md | 開工必讀 | Current state and handoff |
| FEATURE_MAP.md | 揀嘢前查 | Feature-to-file ownership |
| DECISIONS.md | 做 i18n pipeline 或安裝問題先讀 | Durable design decisions |
