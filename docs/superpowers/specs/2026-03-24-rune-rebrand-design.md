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
| Target ID prefix | `wcli_` | `rune_` |
| Binary name | `webcli-mcp` | `rune-mcp` |
| Extension name | webcli-dom | rune |
| Plugin name | webcli | rune |

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

## MCP Tool Renames (7 tools)

| Before | After |
|--------|-------|
| `webcli_sessions` | `rune_sessions` |
| `webcli_snapshot` | `rune_snapshot` |
| `webcli_act` | `rune_act` |
| `webcli_fill` | `rune_fill` |
| `webcli_drag` | `rune_drag` |
| `webcli_wait` | `rune_wait` |
| `webcli_guide` | `rune_guide` |

---

## DOM Attribute Renames (8 attributes)

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

---

## File-Level Change Map

### Package manifests (6 files)
- `/package.json` — root workspace name
- `/packages/core/package.json`
- `/packages/build-core/package.json`
- `/packages/extension/package.json`
- `/packages/mcp-server/package.json`
- `/apps/cli-test-page/package.json`

### Configuration (3 files)
- `/tsconfig.base.json` — path aliases `@webcli-dom/*` → `@runeai/*`
- `/packages/extension/manifest.json` — extension name & description
- `/plugins/webcli/.claude-plugin/plugin.json` — plugin metadata

### Installation & system (2 files)
- `/packages/mcp-server/src/install.ts` — native host name, directory paths, descriptions
- `/packages/mcp-server/bin/webcli-mcp.ts` — binary name, directory constants

### User-facing strings (2 files)
- `/packages/extension/src/popup/popup.html` — window title
- `/packages/extension/src/shared/config.ts` — storage keys

### Documentation (3+ files)
- `/docs/agent-setup.md`
- `/docs/native-messaging-transition-worklog.md`
- `/apps/cli-test-page/README.md`

### Source code (~500+ occurrences across ~38+ files)
- All TypeScript files importing `@webcli-dom/*`
- All files using `data-webcli-*` attribute strings
- All files using `webcli_` tool name prefix
- All files using `wcli_` target ID prefix
- All test files referencing any of the above

### Plugin directory rename
- `/plugins/webcli/` → `/plugins/rune/`

---

## Implementation Strategy

1. **Global find-and-replace** with careful ordering to avoid partial matches:
   - `@webcli-dom/` → `@runeai/` (package imports)
   - `@webcli-apps/` → `@runeai/` (app imports)
   - `webcli-dom` → `rune` (standalone references)
   - `data-webcli-` → `data-rune-` (DOM attributes)
   - `webcli_` → `rune_` (MCP tools, target IDs)
   - `wcli_` → `rune_` (target ID prefix)
   - `com.webcli.dom` → `com.runeai.rune` (system identifier)
   - `.webcli-dom` → `.runeai` (home directory)
   - `webcli-mcp` → `rune-mcp` (binary)
   - `webcli` → `rune` (remaining references — careful with context)

2. **Directory renames**:
   - `plugins/webcli/` → `plugins/rune/`
   - Binary file: `webcli-mcp.ts` → `rune-mcp.ts`

3. **Verification**:
   - `grep -r "webcli" .` should return zero results (excluding git history)
   - TypeScript compilation passes
   - All tests pass
   - Extension loads correctly

---

## Out of Scope

- Domain registration (runeai.com) — manual step
- npm org creation (@runeai) — manual step
- GitHub org creation (runeai) — manual step
- Logo/visual identity redesign
- Git repository rename (directory stays as-is until GitHub org is ready)
