> 讀法：做 i18n pipeline 先讀 ｜ 內容：架構決定與取捨 ｜ 上限：30KB

# DECISIONS

## 2026-10-26 — Italian only, in its own repository

**Decision:** split the Italian locale out of the 20-locale fork into `gradia64/dsh-i18n-it`
(`@gradia64/dsh-i18n-it`), keeping git history, and drop every other locale together with the
Traditional Chinese converter, the Simplified-residue gate and RTL handling.

**Why:** the plugin is installed only locally from GitHub (not on npm or the Market) and used only in
Italian. After the 0.2.0-rc.2 and 0.2.1-rc.2 extractions, 17 locales were ~19% translated
(~2350 of 2910 values still English each) and every DSH release widened the gap; their English
placeholders were ~2.1 MB of the 2.98 MB client bundle. Italian alone is 178 KB, and each DSH update
means translating one locale instead of twenty.

**Kept stable:** internal ids (`dsh-i18n` cordis id, `/api/dsh-i18n.translate`, localStorage keys,
cache dir), so the selected language and translation cache carry over. Only the package name changes,
which the ModuleLoader id and `cordis.patch.yml` follow.

**Not chosen:** keeping 20 locales with English placeholders (bundle cost, maintenance with no user);
a fresh repository without history (loses the extraction and translation record).

## 2026-09-29 — DSH 0.2.0-rc.2 compatibility

**Decision:** bump the plugin to support `@deepseek-ai/dsh` 0.2.0-rc.2; add the 0.2.0-rc.2
prerelease branch to `peerDependencies`, declare `engines.dsh`, set `manifestVersion: 1`,
and add `@deepseek-ai/dsh-client-connection` to `dsh.client.inject`.

Peer ranges become:
```jsonc
"@deepseek-ai/dsh-client-locale": ">=0.1.0-rc.6 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.2.1-0",
"@deepseek-ai/dsh-llm":         ">=0.1.0-rc.2 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.2.1-0"
```

**Why:** npm `@deepseek-ai/dsh` `latest`/`next` is now `0.2.0-rc.2`. The 0.1.1-rc ranges
exclude 0.2.0-rc.2 outright. The old `|| >=0.1.1-rc.1 <0.2.0-0` branch is retained so
installs that haven't upgraded yet are not blocked. `engines.dsh` declares the compatible
DSH version range; `manifestVersion: 1` aligns with the `dsh-package-manifest` format
checked by the 0.2.0-rc.2 plugin manager. `@deepseek-ai/dsh-client-connection` is added
to `inject` so the client bundle's `connection.rpc.call` (auto-translate) materializes
after the connection service is ready.

**Host entry (`index.mjs`) fixes:**
- `createUserMessage` source changed from `{ kind: "plugin", plugin: "dsh-i18n" }` to
  `{ kind: "user" }`. In 0.2.0-rc.2 `MessageSourceMap` no longer defines a `plugin` kind
  for user messages; only `{ kind: "user" }` is valid.
- `purpose: "dsh-i18n-translate"` removed from `GenerateOptions`. In 0.2.0-rc.2,
  `purpose` is restricted to `'compaction' | 'session-title'`. The DeepSeek adapter
  uses `purpose` to decide reasoning-effort defaults (`session-title` → `"off"`);
  for translation we now explicitly default `reasoningEffort` to `"off"` when the
  caller did not pin one, since translation is a one-shot task that does not benefit
  from chain-of-thought reasoning.
- `BlockAssembler`, `createUserMessage`, and `ctx.llm.stream` are still exported and
  work unchanged in `dsh-llm@0.2.0-rc.2`.

**Extractor / locale source updates:**
- `scripts/extract.mjs` `PKGS` list grew from 28 to 40 upstream packages (12 new:
  `dsh-client-ui-approval`, `dsh-client-ui-layout`, `dsh-client-ui-settings-account`,
  `dsh-client-ui-settings-agent-loop`, `dsh-client-ui-settings-session-log`,
  `dsh-client-ui-settings-shell`, `dsh-client-ui-settings-web-search`,
  `dsh-client-ui-sidebar-browser`, `dsh-client-ui-sidebar-documentpreview`,
  `dsh-client-ui-sidebar-files`, `dsh-client-ui-sidebar-right`,
  `dsh-client-ui-sidebar-terminal`).
  `dsh-client-ui-directory-picker-native` and `dsh-client-ui-tool` were found to have
  no `locale.register` calls and were deliberately excluded.
- `src/zh-src/` and `src/en/` re-extracted from DSH 0.2.0-rc.2 client bundles
  (1665 keys total, up from 715).
- `scripts/migrate-locales.mjs` added to merge new keys into existing locale files
  (English placeholders for untranslated keys) and create new package files for all
  20 locales.
- `scripts/check.mjs` keeps English residue and simplified residue as hard failures.
  The only exception is an explicit list, `scripts/pending-translation.json`
  (`<locale>/<file>/<ns>.<key>`), generated with `--record-pending`: listed keys are
  warnings, and a listed key that is no longer untranslated fails, so the list can only
  shrink. The script sets `process.exitCode` instead of calling `process.exit()`, which
  could truncate piped output and hide the failure messages behind thousands of warnings.
- `scripts/fill-traditional.mjs` fills zh-HK/zh-TW keys that `migrate-locales.mjs` left
  as English with the zh-src value converted through `src/zh-tw-parts/chars.json`, the
  same result the runtime Simplified→Traditional fallback produces. Without it the
  English placeholder would bypass that fallback (1092 keys per locale). Character-level
  conversion keeps mainland vocabulary (e.g. 設置 rather than 設定); proper zh-HK/zh-TW
  wording is left for a follow-up.

**DOM skip selector update:**
- `[data-agent-teams-panel-open]` and `[data-agent-teams-collapsed]` (removed in
  0.2.0-rc.2) replaced by `[data-team-panel]` and `[data-team-action]` (from
  `@deepseek-ai/dsh-experimental-client-ui-agent-team@0.2.0-rc.2`).

**Not chosen:** machine-translating the new keys via the plugin's own
`/api/dsh-i18n.translate` endpoint as part of this change. Keeping translation
out of the compatibility work makes the diff reviewable and lets the 12 new
packages be translated (and checked by native speakers) in a separate step.
Until then the runtime falls back to English (or Simplified-to-Traditional
conversion for zh-HK/zh-TW) for untranslated keys, preserving full UI
functionality.

## 2026-09-09 — Do not convert streaming conversation text

**Decision:** zh-TW DOM conversion and auto-MT observers ignore `characterData`, skip conversation / composer / AgentTeams live surfaces (`[data-conversation-scroll]`, `[data-composer-input]`, `[data-composer-card]`, `[data-composer-seat]`, `[data-team-id]`, `[data-agent-teams-panel-open]`, `[data-agent-teams-collapsed]`), coalesce leftover `childList` work onto `requestAnimationFrame`, and never re-walk those trees after an MT RPC. Chrome and settings still convert via `childList`.

**Why:** both observers used `{ childList, subtree, characterData: true }` on `document.body`. Streaming tokens are `characterData` inside the conversation scrollport. With many concurrent agents that callback walks and rewrites text on every token, which stalls the renderer so inference stays alive while glyphs do not paint. Desktop 2.0.3 logs show the same pressure as `renderer process gone (reason: killed)` plus GPU/Network/Audio child kills.

**Not chosen:** patching packaged `dsh-plugin-desktop` / `@deepseek-ai/dsh-web-app` in the asar (Desktop will not load the local harness checkout); hiding or limiting agents; upgrading `@nanmicoder/dsh-agent-teams` past 0.1.14 (0.1.15 fails renderer boot).

## 2026-08-27 — Peer ranges must name the current 0.1.1-rc tuple

**Decision:** `peerDependencies` use an explicit prerelease branch for the current
harness line, and Cordis is declared as `@deepseek-ai/cordis` (not unscoped `cordis`):

```json
"@deepseek-ai/cordis": "^4.0.1",
"@deepseek-ai/dsh-client-locale": ">=0.1.0-rc.6 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0",
"@deepseek-ai/dsh-llm": ">=0.1.0-rc.2 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0"
```

`engines.node` is `^22.19.0 || >=24.0.0`. The contract is asserted by
`scripts/verify-peers.mjs`.

**Why:** npm `@deepseek-ai/dsh` `latest`/`next` is `0.1.1-rc.2` (tag `dsh-v0.1.1-rc.2`).
node-semver only lets a prerelease satisfy a range when some comparator shares that
exact `major.minor.patch` tuple and itself carries a prerelease tag. The previous
`>=0.1.0-rc.6` range matched `0.1.0-rc.*` and stable `0.1.1`, but silently excluded
`0.1.1-rc.2` — the version users actually install. awesome-dsh-plugin contributing
documents this and requires the `|| >=0.1.1-rc.1 <0.2.0-0` shape.

Host packages in 0.1.1-rc.2 depend on `@deepseek-ai/cordis@^4.0.1`, not `cordis`.
`dsh-llm@0.1.1-rc.2` still exports `BlockAssembler` and `createUserMessage`; no API
rewrite was needed.

**Not chosen:** pinning only `^0.1.1-rc.2` (drops Desktop / rc.6–rc.8 installs);
keeping unscoped `cordis` (host no longer supplies that name).

**Sources:**
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/package.json
- https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
- https://www.npmjs.com/package/@deepseek-ai/dsh

## 2026-08-24 — The gate must check content, not only structure

**Decision:** `scripts/check.mjs` also fails on (a) a value byte-identical to English that still contains at least
3 English words after stripping placeholders, slash commands, file names and a literal-term whitelist, and
(b) any Simplified character (keys of `src/zh-tw-parts/chars.json`) appearing in a `traditional` locale.

**Why:** an independent review found the structural-only gate reported `i18n check passed: 20 locales × 28 files`
while `nl`/`tr`/`id`/`th` shipped 65–100 untranslated English sentences each, and both Traditional locales
shipped 占 instead of 佔. A green gate that cannot fail on the plugin's actual purpose certifies nothing.

**Why a word threshold rather than plain equality:** plain equality produces false positives on legitimate values —
pure format strings (`{y}-{m}-{d}`, `{tps} tok/s`), retained proper nouns (DSH, JSON, Cordis), and single words
that genuinely coincide (Polish "Model", Swedish "Standard mode"). The 3-word threshold catches English prose
without punishing correct translations.

**Why the Simplified check cannot be delegated to `verify-converter.mjs`:** the runtime applies `convertZhTw`
only on the fallback branch (`lib/client.js`, `const fallbackLang = lang.useConvert ? "zh" : "en"`). A curated
value is returned as-is, so Simplified residue in curated data reaches the UI while the converter test stays green.

**Not chosen:** a language-detection library or a translation-quality metric — non-deterministic, and a gate that
cannot be reproduced offline is not a gate.

## 2026-08-24 — Install path: terminal `dsh plugin add` with a pinned github spec

**Decision:** the fork is installed into the **active** DSH Desktop profile with
`dsh plugin --profile <active> add github:mimateinn/dsh-multi-lang-ui#<commit>`, not through the Market UI.

**Why (verified against DSH Desktop 2.0.2 code, read-only audit 2026-08-24):** the three install paths enforce different version rules.
- Community Market (`dsh-community-market/lib/install/service.js`): exact **stable** semver only — `stableExactVersion()` rejects prereleases; `observeCatalog` skips any item whose `package.registry !== 'npm'`; `install/manual.js` deliberately refuses to even print a GitHub install command.
- dsh-market (`dshmarket/lib/dsh-cli.js` `desktopInstallIdentity`, plus the Host boundary `app.asar.unpacked/lib/pnpm.js` `NPM_EXACT_VERSION_PATTERN`): exact published npm version (prerelease allowed); a `github:owner/repo#sha` spec fails the name regex → `dsh-market: DSH Desktop managed installation requires an npm package with an exact published version`.
- Built-in terminal shim `host-commands/<profile>/bin/dsh.cmd` → `lib/desktop-cli.js`: **no specifier validation at all** — argv is forwarded to pnpm, so `github:...#<commit>` is accepted. The installed `dshmarket` dependency itself is a github pin, which proves this path.

Since `dsh-multi-lang-ui` is not published on npm (registry returns 404) and no npm identity is authenticated on this machine, the two Market paths are structurally unavailable. Publishing stays a later step; it does not block installation.

**Not chosen:** loosening Desktop's managed-install policy, or publishing a placeholder version to npm just to satisfy the Market path.

## 2026-08-24 — Install into the profile Desktop actually boots

**Decision:** target the profile named in `%APPDATA%/DSH Desktop/profile-selection/state.json` (`active`, after `pending`/`lastKnownGood` resolution), currently `desktop`.

**Why:** each shim hard-codes its profile (`DSH_DESKTOP_DEFAULT_PROFILE`) and `withDefaultDesktopProfile()` injects it into `plugin` argv, so `host-commands/web/bin/dsh.cmd plugin add` mutates `~/.dsh/profiles/web` even while Desktop is running `desktop` — the plugin installs successfully and is never loaded. That is exactly the earlier symptom (v0.1.0 sitting in the `web` profile).

**Consequence:** both shims share one install-recovery WAL (`plugin-install-recovery/state.json`). A terminal install under a non-active profile leaves a WAL bound to that profile, and the next start logs `deferred plugin install recovery (profile-mismatch) for manual-plugin-install`; the transaction is never finalised and blocks every later managed install until Desktop next boots with that same profile active. Installing under the active profile avoids this entirely.

## 2026-08-19 — One locale registry

**Decision:** `scripts/locales.mjs` is the single source for locale id, source directory, display label, Traditional fallback, and RTL metadata.

**Why:** validation and assembly cannot drift onto different locale lists. A registered locale with incomplete files fails loudly.

**Not chosen:** silently assembling only directories that happen to exist, because that makes advertised coverage nondeterministic.

## 2026-08-19 — Preserve the DSH loader contract

**Decision:** generation retains the existing `window.__ModuleLoader__.load` CJS factory and wraps the existing locale runtime rather than replacing it.

**Why:** this preserves plugin loading, built-in locale handling, preference adoption, and graceful degradation.

## 2026-08-19 — Runtime fallbacks

**Decision:** zh-HK and zh-TW use the existing Simplified-to-Traditional converter; other missing translations use English. Arabic owns document `rtl` while active and managed non-Arabic locales restore `ltr`.