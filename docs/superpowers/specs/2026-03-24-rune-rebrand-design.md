# Rune Rebrand Design Spec

## Overview

Rename the project from **webcli-dom** to **rune** across all surfaces: packages, MCP tools, DOM attributes, system identifiers, and documentation.

### Motivation

- The current name "webcli" implies a CLI tool, but the product operates via MCP (Model Context Protocol)
- "rune" — a meaningful brand name evoking the concept of inscribing annotations (runes) onto DOM elements for AI agents to read
- Future direction includes QA automation; a neutral brand avoids being tied to a single feature

### Brand Identity

| Property | Value |
|----------|-------|
| Brand name | **rune** |
| Domain | runeai.com |
| npm scope | @runeai |
| GitHub org | runeai |
| Tagline | Browser automation for AI agents via annotated DOM elements |

---

## Naming Conventions

### Before → After

| Surface | Before | After |
|---------|--------|-------|
| Root workspace | `webcli-dom` | `rune` |
| npm scope | `@webcli-dom/*` | `@runeai/*` |
| Apps scope | `@webcli-apps/*` | `@runeai/*` |
| Native host identifier | `com.webcli.dom` | `com.runeai.rune` |
| Home directory | `~/.webcli-dom/` | `~/.runeai/` |
| MCP tool prefix | `webcli_` | `rune_` |
| DOM attribute prefix | `data-webcli-` | `data-rune-` |
| Internal DOM attributes | `data-webcli-aurora`, `data-webcli-pointer` | `data-rune-aurora`, `data-rune-pointer` |
| Element ID | `webcli-cursor-style` | `rune-cursor-style` |
| Target ID prefix | `wcli_` | `rune_` |
| Internal target ID prefix | `__wcli_idx_` | `__rune_idx_` |
| Binary name | `webcli-mcp` | `rune-mcp` |
| Extension name | webcli-dom | rune |
| Plugin name | webcli | rune |
| PascalCase type prefix | `WebCli` | `Rune` |
| camelCase variable prefix | `webCli` | `rune` |
| UPPER_CASE constant prefix | `WEBCLI` | `RUNE` |
| Global window property | `window.webcliDom` | `window.runeDom` |
| Internal global key | `__webcli_dom_page_agent_runtime__` | `__rune_page_agent_runtime__` |
| Bridge constant | `__webcli_dom_bridge__` | `__rune_bridge__` |
| Log prefix | `[webcli-extension]` | `[rune-extension]` |

---

## Package Renames (6 packages)

| Before | After |
|--------|-------|
| `webcli-dom` (root) | `rune` |
| `@webcli-dom/core` | `@runeai/core` |
| `@webcli-dom/build-core` | `@runeai/build-core` |
| `@webcli-dom/extension` | `@runeai/extension` |
| `@webcli-dom/mcp-server` | `@runeai/mcp-server` |
| `@webcli-apps/cli-test-page` | `@runeai/test-page` |

---

## MCP Tool Renames (8 tools)

| Before | After |
|--------|-------|
| `webcli_sessions` | `rune_sessions` |
| `webcli_snapshot` | `rune_snapshot` |
| `webcli_act` | `rune_act` |
| `webcli_fill` | `rune_fill` |
| `webcli_drag` | `rune_drag` |
| `webcli_wait` | `rune_wait` |
| `webcli_guide` | `rune_guide` |
| `webcli_config` | `rune_config` |

---

## DOM Attribute Renames (10 attributes)

### User-facing annotation attributes (8)

| Before | After |
|--------|-------|
| `data-webcli-action` | `data-rune-action` |
| `data-webcli-name` | `data-rune-name` |
| `data-webcli-desc` | `data-rune-desc` |
| `data-webcli-key` | `data-rune-key` |
| `data-webcli-group` | `data-rune-group` |
| `data-webcli-group-name` | `data-rune-group-name` |
| `data-webcli-group-desc` | `data-rune-group-desc` |
| `data-webcli-sensitive` | `data-rune-sensitive` |

### Internal DOM identifiers (2 attributes + 1 element ID)

| Before | After |
|--------|-------|
| `data-webcli-aurora` | `data-rune-aurora` |
| `data-webcli-pointer` | `data-rune-pointer` |
| `webcli-cursor-style` (element ID) | `rune-cursor-style` |

---

## TypeScript Type/Interface Renames

| Before | After | Location |
|--------|-------|----------|
| `WebCliRuntimeConfig` | `RuneRuntimeConfig` | `packages/core/src/index.ts` |
| `WebCliExposureMode` | `RuneExposureMode` | `packages/build-core/src/types.ts` |
| `WebCliRuntimeOptions` | `RuneRuntimeOptions` | `packages/build-core/src/types.ts` |
| `WebCliSupportedAction` | `RuneSupportedAction` | `packages/build-core/src/types.ts` |
| `WebCliToolStatus` | `RuneToolStatus` | `packages/build-core/src/types.ts` |
| `WebCliTargetEntry` | `RuneTargetEntry` | `packages/build-core/src/types.ts` |
| `WebCliToolEntry` | `RuneToolEntry` | `packages/build-core/src/types.ts` |
| `WebCliGroupEntry` | `RuneGroupEntry` | `packages/build-core/src/types.ts` |
| `WebCliManifest` | `RuneManifest` | `packages/build-core/src/types.ts` |
| `WebCliBackend` | `RuneBackend` | `packages/mcp-server/src/backend.ts` |
| `registerWebCliTools` | `registerRuneTools` | `packages/mcp-server/src/mcp-tools.ts` |

---

## File-Level Change Map

### Package manifests (6 files)
- `/package.json` — root workspace name
- `/packages/core/package.json`
- `/packages/build-core/package.json`
- `/packages/extension/package.json`
- `/packages/mcp-server/package.json`
- `/apps/cli-test-page/package.json`

### Configuration (5 files)
- `/tsconfig.base.json` — path aliases `@webcli-dom/*` → `@runeai/*`
- `/packages/extension/manifest.json` — extension name & description
- `/packages/extension/vite.config.ts` — build chunk names (`webcliContentScript`, etc.)
- `/packages/mcp-server/tsup.config.ts` — entry point `bin/webcli-mcp.ts` → `bin/rune-mcp.ts`
- `/plugins/webcli/.claude-plugin/plugin.json` — plugin metadata

### Installation & system (2 files)
- `/packages/mcp-server/src/install.ts` — native host name, directory paths, descriptions
- `/packages/mcp-server/bin/webcli-mcp.ts` — binary name, directory constants

### User-facing strings (2 files)
- `/packages/extension/src/popup/popup.html` — window title
- `/packages/extension/src/shared/config.ts` — storage keys

### Runtime globals, bridge & CSS (3 files)
- `/packages/build-core/src/runtime/page-agent-runtime.ts` — `window.webcliDom`, `__webcli_dom_page_agent_runtime__`, internal DOM attributes, CSS classes (`.webcli-cursor`, `.webcli-cursor-filling`, `.webcli-cursor-border`, `.webcli-cursor-ripple`, `@keyframes webcli-ripple`)
- `/packages/extension/src/runtime/page-runtime.ts` — `window.webcliDom`, `__webcli_dom_bridge__`
- `/packages/extension/src/content/bridge.ts` — `__webcli_dom_bridge__`

### Content script internals (1 file)
- `/packages/extension/src/content/index.ts` — `WEBCLI_SELECTOR`, `isWebcliNode`, `webcli-cursor-style`

### Documentation (4+ files)
- `/docs/agent-setup.md`
- `/docs/native-messaging-transition-worklog.md`
- `/docs/ipc-communication-patterns.md`
- `/apps/cli-test-page/README.md`

### Plugin files
- `/plugins/webcli/skills/annotate/SKILL.md` — extensive `webcli` references (~40 occurrences)

### High-density test files
- `/packages/build-core/tests/runtime.spec.ts` — ~80 occurrences
- `/packages/extension/tests/dom-scanner.spec.ts` — ~30 occurrences
- `/packages/mcp-server/tests/tools.spec.ts` — ~20 occurrences
- `/packages/mcp-server/tests/install.spec.ts` — ~15 occurrences (native host name, system paths, test fixtures)
- `/packages/mcp-server/tests/backend.spec.ts` — ~10 occurrences
- `/packages/extension/tests/popup.spec.ts` — ~10 occurrences
- `/packages/extension/tests/background/message-router.spec.ts` — ~10 occurrences

### Source code (~500+ occurrences across ~38+ files)
- All TypeScript files importing `@webcli-dom/*`
- All files using `data-webcli-*` attribute strings
- All files using `webcli_` tool name prefix
- All files using `wcli_` target ID prefix
- All files with `WebCli*` type/class names
- All test files referencing any of the above

### Directory & file renames
- `/plugins/webcli/` → `/plugins/rune/`
- `/packages/mcp-server/bin/webcli-mcp.ts` → `/packages/mcp-server/bin/rune-mcp.ts`

---

## Implementation Strategy

1. **Global find-and-replace** with careful ordering (most specific first):
   - `@webcli-dom/` → `@runeai/` (package imports)
   - `@webcli-apps/` → `@runeai/` (app imports)
   - `__webcli_dom_page_agent_runtime__` → `__rune_page_agent_runtime__` (internal global)
   - `__webcli_dom_bridge__` → `__rune_bridge__` (bridge constant)
   - `webcli-dom` → `rune` (standalone references)
   - `com.webcli.dom` → `com.runeai.rune` (system identifier)
   - `.webcli-dom` → `.runeai` (home directory)
   - `data-webcli-` → `data-rune-` (DOM attributes, covers all 10)
   - `webcli-mcp` → `rune-mcp` (binary)
   - `webcli-cursor-style` → `rune-cursor-style` (element ID)
   - `webcli-extension` → `rune-extension` (log prefix)
   - `webcli_` → `rune_` (MCP tools, target IDs)
   - `__wcli_idx_` → `__rune_idx_` (internal target ID delimiter)
   - `wcli_` → `rune_` (target ID prefix)
   - `WebCli` → `Rune` (PascalCase types/classes)
   - `webCli` → `rune` (camelCase variables — e.g., `webcliDom` → `runeDom`)
   - `WEBCLI` → `RUNE` (UPPER_CASE constants)
   - `webcli` → `rune` (remaining lowercase references)

2. **Directory & file renames**:
   - `plugins/webcli/` → `plugins/rune/`
   - `packages/mcp-server/bin/webcli-mcp.ts` → `packages/mcp-server/bin/rune-mcp.ts`

3. **Lockfile regeneration**:
   - Do NOT find-and-replace in `pnpm-lock.yaml`
   - Delete `pnpm-lock.yaml` and run `pnpm install` to regenerate

4. **Vite chunk name updates** (in `packages/extension/vite.config.ts`):
   - `webcliContentScript` → `runeContentScript`
   - `webcliBackgroundServiceWorker` → `runeBackgroundServiceWorker`
   - `webcliPopup` → `runePopup`
   - `webcliPageRuntime` → `runePageRuntime`

5. **Verification**:
   - `grep -ri "webcli" .` should return zero results (excluding git history and node_modules)
   - `grep -ri "wcli" .` should return zero results (same exclusions)
   - TypeScript compilation passes (`pnpm build`)
   - All tests pass (`pnpm test`)
   - Extension loads correctly in Chrome

---

## Out of Scope

- Domain registration (runeai.com) — manual step
- npm org creation (@runeai) — manual step
- GitHub org creation (runeai) — manual step
- Logo/visual identity redesign
- Git repository rename (directory stays as-is until GitHub org is ready)
- Extension storage key migration (`companion_config` does not contain "webcli", left as-is)
