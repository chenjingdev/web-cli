# MCP Snapshot Token Optimization Design

## Goal

Reduce token consumption in `agrune_snapshot` responses by removing redundant fields and avoiding repeated data, without losing information the AI agent needs.

## Context

The MCP server returns page snapshots to AI agents. Currently, every target includes status fields that are redundant or already present in group summaries, and expand responses repeat group summary data the agent already has.

## Changes

### 1. Target field reduction

**Before (12 fields):**

```typescript
interface PublicSnapshotTarget {
  targetId: string
  groupId: string
  groupName?: string
  groupDesc?: string
  name: string
  description: string
  actionKind: ActionKind
  visible: boolean
  enabled: boolean
  reason: PageTargetReason
  sensitive: boolean
  textContent?: string
}
```

**After (7 required + 1 optional):**

```typescript
interface PublicSnapshotTarget {
  targetId: string
  groupId: string
  name: string
  description: string
  actionKind: ActionKind
  reason: PageTargetReason
  sensitive: boolean
  textContent?: string  // included only when includeTextContent option is true
}
```

**Removed fields and rationale:**

| Field | Reason for removal |
|-------|-------------------|
| `visible` | Always `true` — `actionableNow` filter guarantees `visible && enabled && !covered` |
| `enabled` | Always `true` — same guarantee |
| `groupName` | Already present in group summary |
| `groupDesc` | Already present in group summary |

**Kept fields:**

| Field | Reason to keep |
|-------|---------------|
| `reason` | Can be `"offscreen"` or `"sensitive"` even for actionable targets |
| `sensitive` | Can be `true` for password/sensitive input fields that are still actionable |

### 2. Expand response: omit group summary

**Before:** `agrune_snapshot({ groupId: "tabs" })` returns both `groups` array (all groups) and `targets` array.

**After:** When expanding specific groups, return `targets` array only. The `groups` field is omitted.

Outline mode (default, no groupId/groupIds) continues to return `groups` as before.

Full mode (`mode: "full"`) also omits `groups` since all targets are included.

**Response shape by mode:**

| Mode | `groups` | `targets` |
|------|----------|-----------|
| Outline (default) | All groups | Omitted |
| Expand (groupId/groupIds) | Omitted | Requested groups only |
| Full (`mode: "full"`) | Omitted | All actionable targets |

### 3. `includeTextContent` option

Add `includeTextContent` boolean parameter to `agrune_snapshot`.

- Default: `false`
- When `true`: each target includes `textContent` field with the element's visible text
- Use case: content analysis tasks where the agent needs to read on-screen text

### 4. Default field documentation

Add to `agrune_snapshot` tool description:

> "Targets only include actionable elements. Omitted fields use defaults: visible=true, enabled=true."

This makes the response self-documenting for agents that don't use the agrune plugin.

## Files to modify

| File | Change |
|------|--------|
| `packages/mcp-server/src/public-shapes.ts` | Update `PublicSnapshotTarget` type, `toPublicTarget()`, `toPublicSnapshot()` |
| `packages/mcp-server/src/tools.ts` | Add `includeTextContent` parameter, update tool description |
| `packages/mcp-server/src/backend.ts` | Pass `includeTextContent` through `resolveSnapshotOptions()` |
| `packages/mcp-server/tests/*.spec.ts` | Update assertions for new response shape |

## Out of scope

- Pretty JSON to compact JSON conversion (kept for human readability)
- Default tab selection improvement (separate task)
- Dev extension reload flow (separate task)
