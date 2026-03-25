# Agagrune Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from webcli-dom to agrune across all packages, tools, DOM attributes, types, and documentation.

**Architecture:** Mechanical find-and-replace executed in a strict order (most-specific patterns first) to avoid partial-match corruption. Directory/file renames happen first, then string replacements, then lockfile regeneration and build verification.

**Tech Stack:** pnpm monorepo, TypeScript, Vite, Chrome Extension (Manifest V3), MCP SDK

**Spec:** `docs/superpowers/specs/2026-03-24-agrune-rebrand-design.md`

---

### Task 1: Rename directories and files

**Files:**
- Rename: `plugins/webcli/` → `plugins/agrune/`
- Rename: `packages/mcp-server/bin/webcli-mcp.ts` → `packages/mcp-server/bin/agrune-mcp.ts`

- [x] **Step 1: Rename plugin directory**

```bash
cd /Users/laonpeople/dev/web-cli
mv plugins/webcli plugins/agrune
```

- [x] **Step 2: Rename binary file**

```bash
mv packages/mcp-server/bin/webcli-mcp.ts packages/mcp-server/bin/agrune-mcp.ts
```

- [x] **Step 3: Verify renames**

```bash
ls plugins/agrune/.claude-plugin/plugin.json && ls packages/mcp-server/bin/agrune-mcp.ts
```

Expected: Both files exist, no errors.

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename webcli directories and files to agrune"
```

---

### Task 2: Find-and-replace — package scopes and long identifiers

These are the most-specific patterns that must be replaced first to avoid partial-match corruption.

**Files:** All `.ts`, `.tsx`, `.json`, `.md`, `.html` files (excluding `node_modules/`, `.git/`, `pnpm-lock.yaml`, `dist/`, and the spec file `docs/superpowers/specs/2026-03-24-agrune-rebrand-design.md`).

**Important:** All `sed` commands below use in-place editing. The exclusion pattern for the spec file must be applied consistently. Use `find` + `sed` to target the right files.

- [x] **Step 1: Define the sed exclusion helper**

All subsequent sed commands should be run using this pattern to find target files:

```bash
cd /Users/laonpeople/dev/web-cli
# Helper: find all source files, excluding dirs and spec
find_src() {
  find . \( -name node_modules -o -name .git -o -name dist -o -name pnpm-lock.yaml \) -pagrune -o \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.md' -o -name '*.html' \) \
    -not -path './docs/superpowers/specs/*' \
    -not -path './docs/superpowers/plans/*' \
    -print
}
```

**Important:** All Task 2–4 steps MUST run in a single shell session so `find_src` remains defined. Alternatively, re-define it at the start of each task.
```

- [x] **Step 2: Replace `@webcli-dom/` → `@agrune/`**

```bash
find_src | xargs sed -i '' 's|@webcli-dom/|@agrune/|g'
```

- [x] **Step 3: Replace `@webcli-apps/` → `@agrune/`**

```bash
find_src | xargs sed -i '' 's|@webcli-apps/|@agrune/|g'
```

- [x] **Step 4: Replace `__webcli_dom_page_agent_runtime__` → `__agrune_page_agent_runtime__`**

```bash
find_src | xargs sed -i '' 's|__webcli_dom_page_agent_runtime__|__agrune_page_agent_runtime__|g'
```

- [x] **Step 5: Replace `__webcli_dom_bridge__` → `__agrune_bridge__`**

```bash
find_src | xargs sed -i '' 's|__webcli_dom_bridge__|__agrune_bridge__|g'
```

- [x] **Step 6: Replace `.webcli-dom` → `.agrune` (home directory)**

This MUST run before the generic `webcli-dom` → `agrune` replacement. Catches all forms: `'.webcli-dom'`, `~/.webcli-dom/`, etc.

```bash
find_src | xargs sed -i '' 's|\.webcli-dom|.agrune|g'
```

- [x] **Step 7: Replace `webcli-dom` → `agrune`**

This catches the root workspace name, extension name, native host references, etc.

```bash
find_src | xargs sed -i '' 's|webcli-dom|agrune|g'
```

- [x] **Step 8: Verify key files**

```bash
grep -r "@webcli-dom" --include='*.ts' --include='*.json' . | grep -v node_modules | grep -v dist | grep -v '.git' | grep -v pnpm-lock | grep -v specs/ | grep -v plans/
grep -r "webcli-dom" --include='*.ts' --include='*.json' --include='*.md' . | grep -v node_modules | grep -v dist | grep -v '.git' | grep -v pnpm-lock | grep -v specs/ | grep -v plans/
```

Expected: Zero results for both.

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: rename package scopes and long identifiers to agrune"
```

---

### Task 3: Find-and-replace — system identifiers, DOM attributes, binary

**Files:** Same source file set as Task 2.

- [x] **Step 1: Replace `com.webcli.dom` → `com.agrune.agrune`**

```bash
find_src | xargs sed -i '' 's|com\.webcli\.dom|com.agrune.agrune|g'
```

- [x] **Step 2: Replace `data-webcli-` → `data-agrune-`**

```bash
find_src | xargs sed -i '' 's|data-webcli-|data-agrune-|g'
```

- [x] **Step 3: Replace `webcli-mcp` → `agrune-mcp`**

```bash
find_src | xargs sed -i '' 's|webcli-mcp|agrune-mcp|g'
```

- [x] **Step 4: Replace `webcli-cursor-style` → `agrune-cursor-style`**

```bash
find_src | xargs sed -i '' 's|webcli-cursor-style|agrune-cursor-style|g'
```

- [x] **Step 5: Replace `webcli-extension` → `agrune-extension`**

```bash
find_src | xargs sed -i '' 's|webcli-extension|agrune-extension|g'
```

- [x] **Step 6: Replace `webcli-cursor` → `agrune-cursor` (CSS classes)**

This catches `.webcli-cursor`, `.webcli-cursor-filling`, `.webcli-cursor-border`, `.webcli-cursor-ripple`, `@keyframes webcli-ripple`, etc.

```bash
find_src | xargs sed -i '' 's|webcli-cursor|agrune-cursor|g'
find_src | xargs sed -i '' 's|webcli-ripple|agrune-ripple|g'
```

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename system identifiers, DOM attributes, and CSS to agrune"
```

---

### Task 4: Find-and-replace — MCP tools, target IDs, type prefixes

**Files:** Same source file set as Task 2.

- [x] **Step 1: Replace `webcli_` → `agrune_` (MCP tools and target IDs)**

```bash
find_src | xargs sed -i '' 's|webcli_|agrune_|g'
```

- [x] **Step 2: Replace `__wcli_idx_` → `__agrune_idx_`**

```bash
find_src | xargs sed -i '' 's|__wcli_idx_|__agrune_idx_|g'
```

- [x] **Step 3: Replace `wcli_` → `agrune_` (remaining target ID prefix)**

```bash
find_src | xargs sed -i '' 's|wcli_|agrune_|g'
```

- [x] **Step 4: Replace `WebCli` → `Agagrune` (PascalCase types and classes)**

```bash
find_src | xargs sed -i '' 's|WebCli|Agagrune|g'
```

- [x] **Step 5: Replace `webCli` → `agrune` (camelCase with capital C)**

This catches `webCliDomPlugin` in SKILL.md and any other camelCase variants with capital C.

```bash
find_src | xargs sed -i '' 's|webCli|agrune|g'
```

- [x] **Step 6: Replace `WEBCLI` → `AGRUNE` (UPPER_CASE constants)**

```bash
find_src | xargs sed -i '' 's|WEBCLI|AGRUNE|g'
```

- [x] **Step 7: Replace remaining `webcli` → `agrune` (catch-all lowercase)**

This catches `webcliDom`, `webcliContentScript`, `webcliBackgroundServiceWorker`, `webcliPopup`, `webcliPageRuntime`, `isWebcliNode`, log strings, comments, etc.

```bash
find_src | xargs sed -i '' 's|webcli|agrune|g'
```

- [x] **Step 8: Spot-check key transformations**

Verify specific files have the right result:

```bash
# Type names should be Agagrune*, not agrune*
grep 'AgagruneRuntimeConfig\|AgagruneBackend\|AgagruneManifest' packages/core/src/index.ts packages/mcp-server/src/backend.ts packages/build-core/src/types.ts

# Window global should be agruneDom
grep 'agruneDom' packages/build-core/src/runtime/page-agent-runtime.ts packages/extension/src/runtime/page-runtime.ts

# MCP tools should be agrune_*
grep 'agrune_sessions\|agrune_snapshot\|agrune_act\|agrune_config' packages/mcp-server/src/tools.ts packages/mcp-server/src/mcp-tools.ts

# Vite chunk names should be agrune*
grep 'agruneContentScript\|agruneBackgroundServiceWorker\|agrunePopup\|agrunePageRuntime' packages/extension/vite.config.ts

# Home directory should be .agrune, not .agrune
grep 'agrune' packages/mcp-server/src/install.ts packages/mcp-server/bin/agrune-mcp.ts
```

Expected: All grep commands return matches.

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: rename MCP tools, target IDs, and type prefixes to agrune"
```

---

### Task 5: Fix root package.json scripts

The root `package.json` has scripts with `@webcli-dom/*` filter patterns that were already replaced in Task 2. Verify and fix the `cli-test-page` rename in the app package name.

**Files:**
- Modify: `/package.json`
- Modify: `/apps/cli-test-page/package.json`

- [x] **Step 1: Verify root package.json**

```bash
cat package.json
```

Expected: `"name": "agrune"`, scripts filter on `@agrune/*`.

- [x] **Step 2: Verify app package name change**

The app package should now be `@agrune/cli-test-page` (from the automated replace). The spec says it should be `@agrune/test-page`. Fix it:

```bash
cd /Users/laonpeople/dev/web-cli
sed -i '' 's|@agrune/cli-test-page|@agrune/test-page|' apps/cli-test-page/package.json
```

- [x] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename test page package to @agrune/test-page"
```

---

### Task 6: Regenerate lockfile and clean dist

**Files:**
- Delete & regenerate: `pnpm-lock.yaml`
- Clean: all `dist/` directories

- [x] **Step 1: Clean dist directories**

```bash
cd /Users/laonpeople/dev/web-cli
find . -name dist -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
```

- [x] **Step 2: Delete lockfile and node_modules**

```bash
rm -f pnpm-lock.yaml
rm -rf node_modules packages/*/node_modules apps/*/node_modules
```

- [x] **Step 3: Reinstall dependencies**

```bash
pnpm install
```

Expected: Clean install with no errors. New `pnpm-lock.yaml` generated with `@agrune/*` references.

- [x] **Step 4: Verify lockfile has no webcli references**

```bash
grep -c "webcli" pnpm-lock.yaml || echo "CLEAN: 0 webcli references"
```

Expected: `CLEAN: 0 webcli references`

- [x] **Step 5: Commit**

```bash
git add pnpm-lock.yaml
git commit -m "chore: regenerate lockfile after agrune rebrand"
```

---

### Task 7: Build verification

- [x] **Step 1: Build all packages**

```bash
cd /Users/laonpeople/dev/web-cli
pnpm build
```

Expected: All packages build without errors.

- [x] **Step 2: If build fails, fix TypeScript errors**

Common issues to watch for:
- Import paths that weren't caught by find-and-replace
- Type names that were partially renamed (e.g., `WebagruneBackend` instead of `AgagruneBackend`)
- Missing exports after rename

Fix any issues found and re-run `pnpm build`.

- [x] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors after agrune rebrand"
```

---

### Task 8: Test verification

- [x] **Step 1: Run all tests**

```bash
cd /Users/laonpeople/dev/web-cli
pnpm test
```

Expected: All tests pass.

- [x] **Step 2: If tests fail, fix test assertions**

Common issues:
- Hardcoded `webcli` strings in test expectations
- Snapshot files with old names
- Test fixtures with old attribute names

Fix any issues found and re-run `pnpm test`.

- [x] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test failures after agrune rebrand"
```

---

### Task 9: Final grep verification

- [x] **Step 1: Grep for any remaining webcli references**

```bash
cd /Users/laonpeople/dev/web-cli
grep -ri "webcli" --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.html' . | grep -v node_modules | grep -v dist | grep -v '.git' | grep -v pnpm-lock | grep -v 'specs/2026-03-24-agrune-rebrand'
```

Expected: Zero results.

- [x] **Step 2: Grep for remaining wcli references**

```bash
grep -ri "wcli" --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.html' . | grep -v node_modules | grep -v dist | grep -v '.git' | grep -v pnpm-lock | grep -v 'specs/2026-03-24-agrune-rebrand'
```

Expected: Zero results.

- [x] **Step 3: If any references found, fix them manually and commit**

```bash
git add -A
git commit -m "fix: clean up remaining webcli references"
```

- [x] **Step 4: Final build + test**

```bash
pnpm build && pnpm test
```

Expected: Build succeeds, all tests pass.

- [x] **Step 5: Final commit (if any changes from step 3)**

```bash
git add -A
git commit -m "refactor: complete agrune rebrand"
```
