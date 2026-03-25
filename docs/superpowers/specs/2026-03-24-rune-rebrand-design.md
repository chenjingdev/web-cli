# Agagrune Rebrand Design Spec

## Overview

Rename the project from **webcli-dom** to **agrune** across all surfaces: packages, MCP tools, DOM attributes, system identifiers, and documentation.

### Motivation

- The current name "webcli" implies a CLI tool, but the product operates via MCP (Model Context Protocol)
- "agrune" — a meaningful brand name evoking the concept of inscribing annotations (agrunes) onto DOM elements for AI agents to read
- Future direction includes QA automation; a neutral brand avoids being tied to a single feature

### Brand Identity

| Property | Value |
|----------|-------|
| Brand name | **agrune** |
| Domain | agrune.com |
| npm scope | @agrune |
| GitHub org | agrune |
| Tagline | Browser automation for AI agents via annotated DOM elements |

---

## Naming Conventions

### Before → After

| Surface | Before | After |
|---------|--------|-------|
| Root workspace | `webcli-dom` | `agrune` |
| npm scope | `@webcli-dom/*` | `@agrune/*` |
| Apps scope | `@webcli-apps/*` | `@agrune/*` |
| Native host identifier | `com.webcli.dom` | `com.agrune.agrune` |
| Home directory | `~/.webcli-dom/` | `~/.agrune/` |
| MCP tool prefix | `webcli_` | `agrune_` |
| DOM attribute prefix | `data-webcli-` | `data-agrune-` |
| Internal DOM attributes | `data-webcli-aurora`, `data-webcli-pointer` | `data-agrune-aurora`, `data-agrune-pointer` |
| Element ID | `webcli-cursor-style` | `agrune-cursor-style` |
| Target ID prefix | `wcli_` | `agrune_` |
| Internal target ID prefix | `__wcli_idx_` | `__agrune_idx_` |
| Binary name | `webcli-mcp` | `agrune-mcp` |
| Extension name | webcli-dom | agrune |
| Plugin name | webcli | agrune |
| PascalCase type prefix | `WebCli` | `Agagrune` |
| camelCase variable prefix | `webCli` | `agrune` |
| UPPER_CASE constant prefix | `WEBCLI` | `AGRUNE` |
| Global window property | `window.webcliDom` | `window.agruneDom` |
| Internal global key | `__webcli_dom_page_agent_runtime__` | `__agrune_page_agent_runtime__` |
| Bridge constant | `__webcli_dom_bridge__` | `__agrune_bridge__` |
| Log prefix | `[webcli-extension]` | `[agrune-extension]` |

---

## Package Renames (6 packages)

| Before | After |
|--------|-------|
| `webcli-dom` (root) | `agrune` |
| `@webcli-dom/core` | `@agrune/core` |
| `@webcli-dom/build-core` | `@agrune/build-core` |
| `@webcli-dom/extension` | `@agrune/extension` |
| `@webcli-dom/mcp-server` | `@agrune/mcp-server` |
| `@webcli-apps/cli-test-page` | `@agrune/test-page` |

---

## MCP Tool Renames (8 tools)

| Before | After |
|--------|-------|
| `webcli_sessions` | `agrune_sessions` |
| `webcli_snapshot` | `agrune_snapshot` |
| `webcli_act` | `agrune_act` |
| `webcli_fill` | `agrune_fill` |
| `webcli_drag` | `agrune_drag` |
| `webcli_wait` | `agrune_wait` |
| `webcli_guide` | `agrune_guide` |
| `webcli_config` | `agrune_config` |

---

## DOM Attribute Renames (10 attributes)

### User-facing annotation attributes (8)

| Before | After |
|--------|-------|
| `data-webcli-action` | `data-agrune-action` |
| `data-webcli-name` | `data-agrune-name` |
| `data-webcli-desc` | `data-agrune-desc` |
| `data-webcli-key` | `data-agrune-key` |
| `data-webcli-group` | `data-agrune-group` |
| `data-webcli-group-name` | `data-agrune-group-name` |
| `data-webcli-group-desc` | `data-agrune-group-desc` |
| `data-webcli-sensitive` | `data-agrune-sensitive` |

### Internal DOM identifiers (2 attributes + 1 element ID)

| Before | After |
|--------|-------|
| `data-webcli-aurora` | `data-agrune-aurora` |
| `data-webcli-pointer` | `data-agrune-pointer` |
| `webcli-cursor-style` (element ID) | `agrune-cursor-style` |

---

## TypeScript Type/Interface Renames

| Before | After | Location |
|--------|-------|----------|
| `WebCliRuntimeConfig` | `AgagruneRuntimeConfig` | `packages/core/src/index.ts` |
| `WebCliExposureMode` | `AgagruneExposureMode` | `packages/build-core/src/types.ts` |
| `WebCliRuntimeOptions` | `AgagruneRuntimeOptions` | `packages/build-core/src/types.ts` |
| `WebCliSupportedAction` | `AgagruneSupportedAction` | `packages/build-core/src/types.ts` |
| `WebCliToolStatus` | `AgagruneToolStatus` | `packages/build-core/src/types.ts` |
| `WebCliTargetEntry` | `AgagruneTargetEntry` | `packages/build-core/src/types.ts` |
| `WebCliToolEntry` | `AgagruneToolEntry` | `packages/build-core/src/types.ts` |
| `WebCliGroupEntry` | `AgagruneGroupEntry` | `packages/build-core/src/types.ts` |
| `WebCliManifest` | `AgagruneManifest` | `packages/build-core/src/types.ts` |
| `WebCliBackend` | `AgagruneBackend` | `packages/mcp-server/src/backend.ts` |
| `registerWebCliTools` | `registerAgagruneTools` | `packages/mcp-server/src/mcp-tools.ts` |

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
- `/tsconfig.base.json` — path aliases `@webcli-dom/*` → `@agrune/*`
- `/packages/extension/manifest.json` — extension name & description
- `/packages/extension/vite.config.ts` — build chunk names (`webcliContentScript`, etc.)
- `/packages/mcp-server/tsup.config.ts` — entry point `bin/webcli-mcp.ts` → `bin/agrune-mcp.ts`
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
- `/plugins/webcli/` → `/plugins/agrune/`
- `/packages/mcp-server/bin/webcli-mcp.ts` → `/packages/mcp-server/bin/agrune-mcp.ts`

---

## Implementation Strategy

1. **Global find-and-replace** with careful ordering (most specific first):
   - `@webcli-dom/` → `@agrune/` (package imports)
   - `@webcli-apps/` → `@agrune/` (app imports)
   - `__webcli_dom_page_agent_runtime__` → `__agrune_page_agent_runtime__` (internal global)
   - `__webcli_dom_bridge__` → `__agrune_bridge__` (bridge constant)
   - `webcli-dom` → `agrune` (standalone references)
   - `com.webcli.dom` → `com.agrune.agrune` (system identifier)
   - `.webcli-dom` → `.agrune` (home directory)
   - `data-webcli-` → `data-agrune-` (DOM attributes, covers all 10)
   - `webcli-mcp` → `agrune-mcp` (binary)
   - `webcli-cursor-style` → `agrune-cursor-style` (element ID)
   - `webcli-extension` → `agrune-extension` (log prefix)
   - `webcli_` → `agrune_` (MCP tools, target IDs)
   - `__wcli_idx_` → `__agrune_idx_` (internal target ID delimiter)
   - `wcli_` → `agrune_` (target ID prefix)
   - `WebCli` → `Agagrune` (PascalCase types/classes)
   - `webCli` → `agrune` (camelCase variables — e.g., `webcliDom` → `agruneDom`)
   - `WEBCLI` → `AGRUNE` (UPPER_CASE constants)
   - `webcli` → `agrune` (remaining lowercase references)

2. **Directory & file renames**:
   - `plugins/webcli/` → `plugins/agrune/`
   - `packages/mcp-server/bin/webcli-mcp.ts` → `packages/mcp-server/bin/agrune-mcp.ts`

3. **Lockfile regeneration**:
   - Do NOT find-and-replace in `pnpm-lock.yaml`
   - Delete `pnpm-lock.yaml` and run `pnpm install` to regenerate

4. **Vite chunk name updates** (in `packages/extension/vite.config.ts`):
   - `webcliContentScript` → `agruneContentScript`
   - `webcliBackgroundServiceWorker` → `agruneBackgroundServiceWorker`
   - `webcliPopup` → `agrunePopup`
   - `webcliPageRuntime` → `agrunePageRuntime`

5. **Verification**:
   - `grep -ri "webcli" .` should return zero results (excluding git history and node_modules)
   - `grep -ri "wcli" .` should return zero results (same exclusions)
   - TypeScript compilation passes (`pnpm build`)
   - All tests pass (`pnpm test`)
   - Extension loads correctly in Chrome

---

## Out of Scope

- Domain registration (agrune.com) — manual step
- npm org creation (@agrune) — manual step
- GitHub org creation (agrune) — manual step
- Logo/visual identity redesign
- Git repository rename (directory stays as-is until GitHub org is ready)
- Extension storage key migration (`companion_config` does not contain "webcli", left as-is)
