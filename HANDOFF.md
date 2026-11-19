> 讀法：開工必讀 ｜ 內容：目前狀態、驗證與下一步 ｜ 上限：50KB

# HANDOFF

## Current state
- 2026-11-19: **0.4.1 — re-extracted from DSH 0.2.2-rc.5.** 65 packages, 4224 keys (was 4223). Only `dsh-client-ui-settings-web-search` changed: new `searchAutoHint` translated; `providerLegacy` changed upstream from "DeepSeek (legacy)" to "DeepSeek server-side search", re-translated as "Ricerca lato server di DeepSeek".
  - `extract.mjs` warns about `dsh-deepseek-chat-import` (new, 31 keys, "Import DeepSeek chats" dialog). Left out of `PKGS` on purpose: it is in `OPTIONAL_BUNDLES` of `dsh-official-bundles`, not in the owner's `web` profile.
  - Engines/peers already cover rc.5; the locale service methods and `dsh-llm` exports the client uses are unchanged.
  - `migrate-locales.mjs` still drops the trailing newline; added back by hand. `npm test` EXIT=0. Not yet checked in the running Web UI.
- 2026-11-14: **0.4.0 — re-extracted from DSH 0.2.2-rc.2.** 65 packages, 4223 keys (was 54 / 2909): 1396 new keys translated, 72 changed English strings re-translated, 82 removed.
  - `extract.mjs`: 0.2.2-rc.2 bundles are minified. It now accepts backtick strings (consts, namespace args, `dictionaries` arrays) and `register(NS, someConst)` where the const is `{ zh: ..., en: ... }`.
  - `PKGS`: +13 packages (`account-notifications`, `action-cards`, `agent-team`, `context-menu`, `creation-recommendations`, `file-actions`, `file-drag`, `plugin-recommendations`, `dsh-cua`, `experimental-client-ui-forge`, `experimental-client-ui-stats`, `experimental-liveshare`, `dsh-message-quotes`); −2 (`deepseek-model-label-1017` removed upstream; `dsh-experimental-client-ui-agent-team` renamed to `dsh-client-ui-agent-team`, `src/it` file moved with git so the translations carried over).
  - Peers: `dsh-client-locale` / `dsh-llm` got a `>=0.2.2-rc.1 <0.3.0-0` branch (the 0.2.1 branch now ends at `<0.2.2`); `verify-peers.mjs` checks it. `engines.dsh` unchanged.
  - Upstream bundles now carry ja/es/fr/de/ru/pt dictionaries in some packages, but built-in languages are still only zh/en. The locale service methods the client uses (`addLanguage`, `register`, `adopt`, `publish`, `setLocale`, `translate`, `getLocale`, `dicts`) are still there.
  - Upstream renames reflected in Italian: reminders → "attività automatiche", plugin market → "indice di plugin", Agent Team panel → "bacheca delle attività"; forge "change request" → "richiesta di modifica", liveshare fork/branch → "dirama/diramazione".
  - `migrate-locales.mjs` still writes no trailing newline (added by hand); the stale `fill-traditional` hint is gone.
  - `npm test` EXIT=0. **Not yet checked on Desktop / in a running DSH 0.2.2-rc.2.**
- 2026-10-28: **0.3.1** — fixes from the old `report_GLM.md` review (4 Oct, written for the 20-locale repo; the rest of it no longer applies):
  - Host (`index.mjs`): `/api/dsh-i18n.translate` rejects payloads over 48 texts, texts that are not non-empty strings ≤ 4000 chars, and `targetLang` that is not a non-empty string ≤ 64 chars (`invalidTranslatePayload`, exported). With `autoTranslate: false` it no longer coerces non-strings.
  - Client auto-translate (`scripts/assemble.mjs`): each translated Text node remembers `{ original, translated }`; switching away from `it` restores the English text. Its own Italian output is no longer re-sent to the model (before, every re-walk sent it again and produced "IT:IT:…" chains). LRU cap of 1000 entries, no duplicate requests for texts in flight, failed texts retried twice after 2 s, post-response walk coalesced into one rAF.
  - `verify-runtime.mjs` derives the expected key count from `src/en` and now drives auto-translate through a mock DOM, timers and RPC (translate, no self re-send, restore, cache reuse, in-flight dedup, bounded retry). The old bundle fails 5 of these checks.
  - `extract.mjs` warns about installed packages that call `locale.register` but are missing from `PKGS`.
  - `index.d.ts` declares `Config` (interface + schema) and `apply(ctx, config)`.
  - `npm test` EXIT=0; host validation checked separately against the real `@deepseek-ai/schemastery` / `dsh-llm` (12 cases). 2026-10-28: reinstalled on Desktop by the owner, works.
- 2026-10-26: **Split from `gradia64/dsh-i18n` (branch `gradia-local` at `6d1b87c`) into `gradia64/dsh-i18n-it`, Italian only.** Package `@gradia64/dsh-i18n-it` `0.3.0`; git history kept. See DECISIONS 2026-10-26.
  - Removed: the 19 other locales in `src/`, the zh-HK/zh-TW Simplified→Traditional converter (`src/zh-tw-parts`, `fill-traditional`, `collect-chars`, `check-missing-chars`, `verify-converter`), the Simplified-residue gate, RTL handling, `verify-dicts.mjs`, `verify/` (Python checks), 20 translated READMEs, `registry-entry.yml`, `src/TERMINOLOGY.md` (zh-TW glossary).
  - Kept: `src/en` + `src/zh-src` (extraction baseline / en fallback), `src/it`, `extract.mjs`, `migrate-locales.mjs`, `check.mjs`, `verify-peers.mjs`, host `index.mjs` unchanged.
  - Internal ids unchanged on purpose: cordis id `dsh-i18n`, `/api/dsh-i18n.translate`, localStorage `dsh-i18n.preference` / `dsh-i18n.mt`, cache `~/.cache/dsh-i18n/`. The chosen language and the translation cache survive the switch; the old and new packages must not be installed together.
  - `lib/client.js`: 2.98 MB → 178 KB. npm pack: 8 files, 59.8 kB.
  - `scripts/pending-translation.json`: 6 entries, all intentional English (app name, URLs, example ids, protocol name).
  - `npm test` EXIT=0 (verify:peers + i18n check + build + runtime harness).
  - 2026-10-26: GUI-verified by the owner: `@gradia64/dsh-i18n` removed, `github:gradia64/dsh-i18n-it` installed on Desktop, Italian UI works.
- 2026-10-30: **Re-extracted from DSH 0.2.1-rc.5.** Only change: `conversation` key `session.moreViewsCurrent` removed (2910 → 2909). No new or changed strings. The 15 new `@deepseek-ai/*` packages have no zh dictionaries, so `PKGS` is unchanged. `dsh-llm`, `dsh-client-locale`, `dsh-client-connection` and `dsh-app-boot` are byte-identical to rc.3. `npm test` EXIT=0. Not yet checked on Desktop.
  - `DOM_SKIP_SELECTOR`: `data-team-id`, `data-recovery`, `data-renderer-recovery`, `data-boot-recovery` are not found in the npm packages, and they were not there in rc.3 either. Left as they are.
  - `migrate-locales.mjs` writes files without a trailing newline and still prints the removed `fill-traditional` step. Add the newline back by hand.
- DSH coverage: dictionaries extracted from **0.2.2-rc.5** (65 packages, 4224 keys); `engines.dsh` `>=0.1.1-rc.2 <0.3.0-0`.

## Next
- Nothing pending. On the next DSH release follow "Updating for a new DSH release" below.

## Updating for a new DSH release
1. Install the new `@deepseek-ai/dsh` (`npm install --ignore-scripts`) somewhere outside the repo.
2. `node scripts/extract.mjs <path>` (it warns about unlisted packages with dictionaries) → `node scripts/migrate-locales.mjs` → translate the new keys in `src/it/` → `node scripts/check.mjs --record-pending` → `npm test` (the expected key count follows `src/en`).
3. Check `dsh-llm`, `dsh-client-locale`, `dsh-client-connection`, `dsh-app-boot` for API changes and that `DOM_SKIP_SELECTOR` attributes still exist upstream; widen `engines.dsh` / peers (and `verify-peers.mjs`) for a new minor line.

## Italian terminology
Steer→"Indirizza", Queue→"Accoda", job→"job", workspace→"spazio di lavoro", change request→"richiesta di modifica", plugin index→"indice di plugin", task board→"bacheca delle attività", fork (session/subagent)→"dirama", preset→"preset", subagent→"subagente", Auto review→"Revisione automatica", Discover→"Scopri", plugin market→"marketplace di plugin", index source→"sorgente dell'indice", automation task→"attività automatica", reminder→"promemoria", registry→"registry", sidebar→"barra laterale", conversation view→"vista conversazione". Keep app/product names, URLs, slash-command tokens and units in English.

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
