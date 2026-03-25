# Snapshot Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce token consumption in `agrune_snapshot` MCP responses by removing redundant target fields, omitting group summaries in expand/full mode, and adding opt-in `includeTextContent`.

**Architecture:** All changes are in `public-shapes.ts` (type + transformation logic), `tools.ts`/`mcp-tools.ts` (tool definition), and `backend.ts` (option plumbing). Tests are updated to match the new response shapes.

**Tech Stack:** TypeScript, vitest, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-03-24-snapshot-token-optimization-design.md`

---

### Task 1: Remove redundant fields from PublicSnapshotTarget

**Files:**
- Modify: `packages/mcp-server/src/public-shapes.ts:26-38` (type), `packages/mcp-server/src/public-shapes.ts:79-94` (toPublicTarget)
- Test: `packages/mcp-server/tests/public-shapes.spec.ts`

- [x] **Step 1: Update the failing test — expand mode should not include removed fields**

In `packages/mcp-server/tests/public-shapes.spec.ts`, update the expand test assertion (line 239-253) to expect the new shape:

```typescript
      targets: [
        {
          targetId: 'filter-search',
          groupId: 'filters',
          name: 'Search Filter',
          description: 'Filter cards by keyword',
          actionKind: 'fill',
          reason: 'ready',
          sensitive: false,
        },
      ],
```

Removed: `groupName`, `groupDesc`, `visible`, `enabled`.

- [x] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune && pnpm --filter @agrune/mcp-server test
```

Expected: FAIL — `toPublicSnapshot` still returns old fields.

- [x] **Step 3: Update PublicSnapshotTarget type**

In `packages/mcp-server/src/public-shapes.ts`, replace the interface (lines 26-39):

```typescript
export interface PublicSnapshotTarget {
  targetId: string
  groupId: string
  name: string
  description: string
  actionKind: PageTarget['actionKind']
  reason: PageTarget['reason']
  sensitive: boolean
  textContent?: string
}
```

- [x] **Step 4: Update toPublicTarget function**

In `packages/mcp-server/src/public-shapes.ts`, replace the function (lines 79-94):

```typescript
function toPublicTarget(target: PageTarget, includeTextContent: boolean): PublicSnapshotTarget {
  return {
    targetId: target.targetId,
    groupId: target.groupId,
    name: target.name,
    description: target.description,
    actionKind: target.actionKind,
    reason: target.reason,
    sensitive: target.sensitive,
    ...(includeTextContent && target.textContent ? { textContent: target.textContent } : {}),
  }
}
```

- [x] **Step 5: Update toPublicSnapshot to pass includeTextContent**

In `packages/mcp-server/src/public-shapes.ts`, add `includeTextContent` to `PublicSnapshotOptions` and update `toPublicSnapshot`:

```typescript
export interface PublicSnapshotOptions {
  mode?: 'outline' | 'full'
  groupIds?: string[]
  includeTextContent?: boolean
}
```

Update the targets mapping line (line 165):

```typescript
...(includeTargets ? { targets: expandedTargets.map(t => toPublicTarget(t, options.includeTextContent ?? false)) } : {}),
```

- [x] **Step 6: Run test to verify it passes**

```bash
cd /Users/chenjing/dev/agrune && pnpm --filter @agrune/mcp-server test
```

Expected: PASS

- [x] **Step 7: Commit**

```bash
cd /Users/chenjing/dev/agrune && git add packages/mcp-server/src/public-shapes.ts packages/mcp-server/tests/public-shapes.spec.ts && git commit -m "refactor: remove redundant fields from PublicSnapshotTarget"
```

---

### Task 2: Omit group summary in expand/full mode

**Files:**
- Modify: `packages/mcp-server/src/public-shapes.ts:147-167` (toPublicSnapshot)
- Test: `packages/mcp-server/tests/public-shapes.spec.ts`

- [x] **Step 1: Update the failing test — expand mode should not include groups**

In `packages/mcp-server/tests/public-shapes.spec.ts`, update the expand test assertion (line 216-254). Remove the entire `groups` array from the expected output:

```typescript
    expect(toPublicSnapshot(snapshot, { groupIds: ['filters'] })).toEqual({
      version: 8,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      context: 'page',
      targets: [
        {
          targetId: 'filter-search',
          groupId: 'filters',
          name: 'Search Filter',
          description: 'Filter cards by keyword',
          actionKind: 'fill',
          reason: 'ready',
          sensitive: false,
        },
      ],
    })
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenjing/dev/agrune && pnpm --filter @agrune/mcp-server test
```

Expected: FAIL — `toPublicSnapshot` still returns `groups` in expand mode.

- [x] **Step 3: Make `groups` optional in PublicSnapshot type and update toPublicSnapshot**

In `packages/mcp-server/src/public-shapes.ts`, update the `PublicSnapshot` interface to make `groups` optional:

```typescript
export interface PublicSnapshot {
  version: number
  url: string
  title: string
  context: 'page' | 'overlay'
  groups?: PublicSnapshotGroup[]
  targets?: PublicSnapshotTarget[]
}
```

Then update the return statement in `toPublicSnapshot`:

```typescript
  const includeGroups = !includeTargets

  return {
    version: snapshot.version,
    url: snapshot.url,
    title: snapshot.title,
    context: activeContext.context,
    ...(includeGroups ? { groups: toPublicGroups(activeContext.targets) } : {}),
    ...(includeTargets ? { targets: expandedTargets.map(t => toPublicTarget(t, options.includeTextContent ?? false)) } : {}),
  }
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd /Users/chenjing/dev/agrune && pnpm --filter @agrune/mcp-server test
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
cd /Users/chenjing/dev/agrune && git add packages/mcp-server/src/public-shapes.ts packages/mcp-server/tests/public-shapes.spec.ts && git commit -m "refactor: omit group summary in expand and full mode"
```

---

### Task 3: Add includeTextContent option to MCP tool

**Files:**
- Modify: `packages/mcp-server/src/tools.ts:21-42`
- Modify: `packages/mcp-server/src/mcp-tools.ts:33-43`
- Modify: `packages/mcp-server/src/backend.ts:132-149`

- [x] **Step 1: Add includeTextContent to tool definitions**

In `packages/mcp-server/src/tools.ts`, add to `agrune_snapshot` properties (after `mode`):

```typescript
          includeTextContent: {
            type: 'boolean',
            description: 'Include visible text content of each target element. Default: false.',
          },
```

In `packages/mcp-server/src/mcp-tools.ts`, add to the `agrune_snapshot` Zod schema (after `mode`):

```typescript
      includeTextContent: z.boolean().optional().describe('Include visible text content of each target element'),
```

- [x] **Step 2: Update tool description**

In `packages/mcp-server/src/tools.ts`, update `agrune_snapshot` description:

```typescript
      description:
        'Get the current active-context snapshot for a browser tab. By default returns a group outline only; use groupId/groupIds or mode="full" to expand actionable targets. Targets only include actionable elements. Omitted fields use defaults: visible=true, enabled=true.',
```

In `packages/mcp-server/src/mcp-tools.ts`, update the description similarly:

```typescript
    'Get the current active-context snapshot. By default returns a group outline; expand groups or request full mode to inspect actionable targets. Targets only include actionable elements. Omitted fields use defaults: visible=true, enabled=true.',
```

- [x] **Step 3: Plumb includeTextContent through resolveSnapshotOptions**

In `packages/mcp-server/src/backend.ts`, update `resolveSnapshotOptions` to include:

```typescript
    return {
      mode: args.mode === 'full' ? 'full' : 'outline',
      ...(groupIds.size > 0 ? { groupIds: [...groupIds] } : {}),
      ...(args.includeTextContent === true ? { includeTextContent: true } : {}),
    }
```

- [x] **Step 4: Run all tests to verify nothing breaks**

```bash
cd /Users/chenjing/dev/agrune && pnpm --filter @agrune/mcp-server test
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
cd /Users/chenjing/dev/agrune && git add packages/mcp-server/src/tools.ts packages/mcp-server/src/mcp-tools.ts packages/mcp-server/src/backend.ts && git commit -m "feat: add includeTextContent option to agrune_snapshot"
```

---

### Task 4: Update backend integration tests

**Files:**
- Modify: `packages/mcp-server/tests/backend.spec.ts:51-147`

- [x] **Step 1: Update expand assertion — remove groups and redundant target fields**

In `packages/mcp-server/tests/backend.spec.ts`, update the expanded snapshot assertion (lines 114-146). Remove `groups`, `groupName`, `groupDesc`, `visible`, `enabled`, `textContent`:

```typescript
    const expanded = await backend.handleToolCall('agrune_snapshot', { tabId: 42, groupId: 'tabs' })
    expect(JSON.parse(expanded.text)).toEqual({
      version: 2,
      url: 'http://localhost:5173',
      title: 'Project Management Tool',
      context: 'page',
      targets: [
        {
          targetId: 'tab-board',
          groupId: 'tabs',
          name: 'Board Tab',
          description: 'Open board',
          actionKind: 'click',
          reason: 'ready',
          sensitive: false,
        },
      ],
    })
```

- [x] **Step 2: Add test for includeTextContent option**

Add a new test in `packages/mcp-server/tests/backend.spec.ts`:

```typescript
  it('includes textContent when includeTextContent is true', async () => {
    const backend = new AgagruneBackend()
    backend.handleNativeMessage({
      type: 'session_open',
      tabId: 42,
      url: 'http://localhost:5173',
      title: 'Test',
    } as NativeMessage)
    backend.handleNativeMessage({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: {
        version: 1,
        capturedAt: Date.now(),
        url: 'http://localhost:5173',
        title: 'Test',
        groups: [],
        targets: [
          {
            targetId: 'btn',
            groupId: 'actions',
            name: 'Save',
            description: 'Save document',
            actionKind: 'click',
            selector: '[data-agrune-key="btn"]',
            visible: true,
            inViewport: true,
            enabled: true,
            covered: false,
            actionableNow: true,
            reason: 'ready',
            overlay: false,
            sensitive: false,
            textContent: 'Save',
            valuePreview: null,
            sourceFile: '',
            sourceLine: 0,
            sourceColumn: 0,
          },
        ],
      },
    } as NativeMessage)

    const result = await backend.handleToolCall('agrune_snapshot', {
      tabId: 42,
      groupId: 'actions',
      includeTextContent: true,
    })
    const parsed = JSON.parse(result.text)
    expect(parsed.targets[0].textContent).toBe('Save')

    const withoutText = await backend.handleToolCall('agrune_snapshot', {
      tabId: 42,
      groupId: 'actions',
    })
    const parsedWithout = JSON.parse(withoutText.text)
    expect(parsedWithout.targets[0].textContent).toBeUndefined()
  })
```

- [x] **Step 3: Run all tests**

```bash
cd /Users/chenjing/dev/agrune && pnpm --filter @agrune/mcp-server test
```

Expected: PASS

- [x] **Step 4: Commit**

```bash
cd /Users/chenjing/dev/agrune && git add packages/mcp-server/tests/backend.spec.ts && git commit -m "test: update backend tests for token-optimized snapshot responses"
```

---

### Task 5: Full build + test verification

- [x] **Step 1: Build all packages**

```bash
cd /Users/chenjing/dev/agrune && pnpm build
```

Expected: All packages build without errors.

- [x] **Step 2: Run all tests**

```bash
cd /Users/chenjing/dev/agrune && pnpm test
```

Expected: All tests pass.

- [x] **Step 3: Fix any issues and commit**

If build or tests fail, fix and commit:

```bash
cd /Users/chenjing/dev/agrune && git add -A && git commit -m "fix: resolve build/test issues after snapshot token optimization"
```
