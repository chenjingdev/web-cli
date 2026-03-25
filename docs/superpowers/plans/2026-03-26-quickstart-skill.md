# Quickstart Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the quickstart onboarding skill that verifies global agrune infra, installs the plugin per-project, and chains into the annotate skill.

**Architecture:** Three deliverables in the `agrune-plugin` repo: (1) marketplace.json for plugin discovery, (2) SKILL.md for the quickstart skill itself, (3) remove the stale Vite plugin section from the annotate skill. All changes are markdown/JSON — no code compilation needed.

**Tech Stack:** Claude Code plugin system (SKILL.md frontmatter, marketplace.json schema)

---

## File Structure

```
agrune-plugin/
  .claude-plugin/
    plugin.json              # Existing — no changes needed
    marketplace.json         # CREATE — marketplace manifest for plugin discovery
  skills/
    quickstart/
      SKILL.md               # CREATE — the quickstart skill
      DRAFT.md               # DELETE — replaced by SKILL.md
    annotate/
      SKILL.md               # MODIFY — remove Vite plugin section (lines 343-364)
```

---

### Task 1: Add marketplace.json

Prerequisite for `claude plugin marketplace add` to work with this repo.

**Files:**
- Create: `agrune-plugin/.claude-plugin/marketplace.json`

- [ ] **Step 1: Create marketplace.json**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "agrune-plugin",
  "description": "agrune browser automation plugin for Claude Code",
  "owner": {
    "name": "agrune"
  },
  "plugins": [
    {
      "name": "agrune",
      "description": "agrune 어노테이션 및 브라우저 자동화 스킬",
      "category": "development",
      "source": "."
    }
  ]
}
```

- [ ] **Step 2: Validate JSON syntax**

Run: `cd /Users/chenjing/dev/agrune/agrune-plugin && python3 -c "import json; json.load(open('.claude-plugin/marketplace.json')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/chenjing/dev/agrune/agrune-plugin
git add .claude-plugin/marketplace.json
git commit -m "feat: add marketplace.json for Claude Code plugin discovery"
```

---

### Task 2: Remove stale Vite plugin section from annotate SKILL.md

The annotate skill references `agruneDomPlugin()` and `@agagrune/build-core/register` which don't exist. This blocks quickstart → annotate chaining.

**Files:**
- Modify: `agrune-plugin/skills/annotate/SKILL.md:343-364`

- [ ] **Step 1: Remove the "Vite 플러그인 설정 확인" section**

Delete lines 343 through end of file of `agrune-plugin/skills/annotate/SKILL.md` — the entire section starting with `## Vite 플러그인 설정 확인`.

The section to remove:
```markdown
## Vite 플러그인 설정 확인

어노테이션이 동작하려면 앱의 `vite.config.ts`에 agrune 플러그인이 등록되어 있어야 한다.
...
import '@agagrune/build-core/register'
```

- [ ] **Step 2: Verify file ends cleanly**

Read the last 10 lines of the modified file. It should end with the wizard navigation code block (closing ``` followed by an empty line, around line 341-342).

- [ ] **Step 3: Commit**

```bash
cd /Users/chenjing/dev/agrune/agrune-plugin
git add skills/annotate/SKILL.md
git commit -m "fix: remove stale Vite plugin section from annotate skill

References agruneDomPlugin() and @agagrune/build-core/register which
are not implemented. The extension injects the runtime directly."
```

---

### Task 3: Write quickstart SKILL.md

The main deliverable. Replace DRAFT.md with the full skill.

**Files:**
- Create: `agrune-plugin/skills/quickstart/SKILL.md`
- Delete: `agrune-plugin/skills/quickstart/DRAFT.md`

- [ ] **Step 1: Create SKILL.md**

```markdown
---
name: quickstart
description: agrune 온보딩 스킬. 사용자가 "agrune 시작", "agrune 셋업", "quickstart", "agrune 설치", "어노테이션 시작", "agrune 연동", "agrune 세팅" 등을 말하면 이 스킬을 사용할 것. 전역 인프라 설치 검증, 프로젝트별 플러그인 설치, 어노테이션까지 풀 플로우를 안내한다.
---

# agrune Quickstart

프로젝트에서 agrune를 처음 사용할 때 실행하는 온보딩 스킬.
전역 인프라 검증 → 프로젝트 플러그인 설치 → 어노테이션까지 풀 플로우를 안내한다.

멱등성을 보장한다. 어느 단계에서 중단되더라도 다시 실행하면 완료된 단계를 스킵한다.

## Phase 0: 프로젝트 타입 확인

1. `package.json` 존재 여부 확인
2. dependencies/devDependencies에 프론트엔드 프레임워크(react, vue, svelte, angular, next, nuxt, solid 등)가 있는지 확인
3. 없으면 사용자에게 안내 후 중단: "agrune는 웹 프론트엔드 프로젝트에서 사용합니다. 프론트엔드 프로젝트 디렉토리에서 다시 실행해주세요."

## Phase 1: 환경 검증 & 전역 설치

### 1.1 Node.js 버전 확인

`node --version` 실행. 22 미만이면 중단:

> "agrune MCP 서버는 Node.js 22 이상이 필요합니다. 현재 버전: {version}"

### 1.2 설치 상태 확인

`~/.agrune/version.json` 파일을 읽어본다.

**파일이 존재하면:** `npx @agrune/cli doctor` 실행 (타임아웃 30초). doctor는 `@clack/prompts` TUI 포맷으로 출력하며 ANSI 이스케이프 코드가 포함될 수 있다. 텍스트 패턴 매칭으로 결과를 판단한다:
- `✘` 또는 `error` 패턴이 **없으면**: 전부 통과. Phase 2로 스킵.
- `✘` 또는 `error` 패턴이 **있으면**: 부분 실패. 사용자에게 안내:

> "일부 agrune 구성요소에 문제가 있습니다. 다음 명령어를 실행해주세요:"
> ```
> ! npx @agrune/cli repair
> ```

repair 완료 후 `npx @agrune/cli doctor`를 다시 실행하여 검증한다. 여전히 실패하면 구체적 실패 항목과 수동 해결 방법을 안내한다.

**파일이 없으면:** 미설치. 1.3으로 진행.

### 1.3 CLI 설치 안내

CLI가 인터랙티브(`@clack/prompts` 멀티셀렉트)이므로 Claude가 직접 실행할 수 없다. 사용자에게 안내:

> "agrune을 설치합니다. 다음 명령어를 실행해주세요:"
> ```
> ! npx @agrune/cli
> ```
> "설치가 완료되면 알려주세요."

### 1.4 최종 검증

사용자가 설치 완료를 알리면 `npx @agrune/cli doctor` 실행 (타임아웃 30초).

- 통과: Phase 2로 진행
- 실패: `! npx @agrune/cli repair` 안내. 그래도 실패하면 수동 해결 안내 후 중단.

### Chrome 확장 확인

doctor 통과 후 사용자에게 한 번 확인:

> "Chrome에 agrune 확장 프로그램이 설치되어 있나요? 확장 프로그램이 없으면 브라우저 제어가 동작하지 않습니다."

설치 안내가 필요하면 CWS 링크 제공: `https://chromewebstore.google.com/detail/gchelkphnedibjihiomlbpjhjlajplke`

## Phase 2: 프로젝트 설정 & 어노테이션

### 2.1 agrune 플러그인 설치

`claude plugin list` 실행. 출력에 "agrune"이 포함되어 있으면 스킵.

없으면 실행:

```bash
claude plugin marketplace add https://github.com/agrune/agrune-plugin
claude plugin install agrune --scope project
```

설치 후 `claude plugin list`로 재확인. 실패하면 오류 내용을 사용자에게 보여주고 수동 설치 안내.

### 2.2 annotate 스킬 호출

annotate 스킬을 호출하여 현재 프로젝트의 컴포넌트에 어노테이션을 적용한다.

## 트러블슈팅

| 증상 | 해결 |
|------|------|
| doctor에서 native host 실패 | `! npx @agrune/cli repair` 실행 |
| 확장 프로그램 연결 안 됨 | Chrome에서 확장 프로그램 새로고침 후 재시도 |
| MCP 서버 연결 안 됨 | Claude 앱 재시작 |
| plugin install 실패 | `claude plugin marketplace add` 먼저 실행했는지 확인 |
```

- [ ] **Step 2: Verify SKILL.md frontmatter parses correctly**

Read the first 5 lines of the new SKILL.md and confirm the YAML frontmatter has `name` and `description` fields.

- [ ] **Step 3: Commit (SKILL.md 추가 + DRAFT.md 삭제)**

```bash
cd /Users/chenjing/dev/agrune/agrune-plugin
git add skills/quickstart/SKILL.md
git rm skills/quickstart/DRAFT.md
git commit -m "feat: add quickstart onboarding skill

Replaces DRAFT.md with full SKILL.md. Guides users through:
- Phase 0: Project type verification
- Phase 1: Global infra check (Node 22+, CLI, doctor/repair)
- Phase 2: Plugin install + annotate skill chaining"
```
