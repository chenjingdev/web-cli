# Quickstart Skill Design

## 개요

agrune의 프로젝트별 온보딩 스킬. 전역 인프라 설치 여부를 검증하고, 프로젝트에 agrune 플러그인을 설치한 후, annotate 스킬로 이어지는 풀 플로우를 제공한다.

## 배경

agrune 사용에는 두 가지 레이어가 있다:

| 레이어 | 스코프 | 설치 방법 |
|--------|--------|----------|
| 인프라 (MCP 서버, 네이티브 호스트, Chrome 확장) | 전역 (한 번) | `npx @agrune/cli` |
| 플러그인 (annotate 스킬) | 프로젝트별 | `claude plugin install` |

CLI는 전역 인프라를 담당하고, quickstart 스킬은 프로젝트 레벨 진입점으로서 전역 설치 검증 + 플러그인 설치 + 어노테이션까지 이어준다.

## 트리거

사용자가 다음을 말하면 이 스킬을 활성화한다:
- "agrune 시작", "agrune 셋업", "quickstart", "agrune 설치", "어노테이션 시작"
- 프로젝트에서 처음 agrune를 사용하려는 의도가 감지될 때

**전제:** 사용자는 자신의 웹앱 프로젝트 디렉토리에서 실행 중이다.

## Phase 0: 프로젝트 타입 확인

- `package.json` 존재 여부 확인
- 프론트엔드 프로젝트(React, Vue, Svelte 등)인지 간단 확인
- 웹앱 프로젝트가 아니면 안내 후 중단: "agrune는 웹 프론트엔드 프로젝트에서 사용합니다"

## Phase 1: 환경 검증 & 전역 설치

멱등성 보장. 이미 완료된 단계는 스킵한다.

### 1.1 Node.js 버전 확인

- `node --version` 실행
- 22 미만이면 안내 후 중단: "agrune MCP 서버는 Node.js 22 이상이 필요합니다"

### 1.2 설치 상태 확인

- `~/.agrune/version.json` 존재 여부 확인
- `npx @agrune/cli doctor` 실행 (Claude가 직접 실행, 타임아웃 30초)
- doctor의 출력에서 `✘` 또는 `error` 패턴을 파싱하여 통과/실패 판단

**참고:** `doctor`는 `@clack/prompts` TUI 포맷으로 출력한다. ANSI 코드가 포함될 수 있으므로 텍스트 패턴 매칭으로 결과를 판단한다.

분기:
- **전부 통과**: Phase 2로 스킵
- **부분 실패**: 사용자에게 `! npx @agrune/cli repair` 실행을 안내 (repair도 인터랙티브 confirm 프롬프트가 있음)
  - repair 후 doctor 재실행하여 검증
  - 여전히 실패하면 구체적 실패 항목과 수동 해결 방법 안내
- **미설치**: 1.3으로 진행

### 1.3 CLI 설치 안내

- CLI가 인터랙티브(`@clack/prompts` 멀티셀렉트)이므로 Claude가 직접 실행할 수 없음
- 사용자에게 `! npx @agrune/cli` 실행을 안내
- 사용자가 완료했다고 하면 doctor로 최종 검증

### 1.4 최종 검증

- `npx @agrune/cli doctor` 실행 (타임아웃 30초)
- 통과하면 Phase 2로 진행
- 실패 시 repair 안내, 그래도 실패면 수동 해결 안내 후 중단

**Chrome 확장 제한:** doctor는 MCP와 네이티브 호스트를 검증하지만, Chrome 확장의 실제 설치 여부는 프로그래밍적으로 확인할 수 없다. doctor 통과 후에도 확장이 없으면 런타임에 실패한다. 사용자에게 Chrome 확장 설치 여부를 한 번 확인한다.

## Phase 2: 프로젝트 설정 & 어노테이션

### 2.1 agrune 플러그인 설치 확인

- `claude plugin list` 실행하여 출력에 "agrune"이 포함되어 있는지 확인

분기:
- **이미 설치됨**: 2.2로 스킵
- **미설치**:
  ```bash
  claude plugin marketplace add https://github.com/agrune/agrune-plugin
  claude plugin install agrune --scope project
  ```
  설치 후 `claude plugin list`로 재확인

### 2.2 annotate 스킬 호출

- annotate 스킬을 호출하여 현재 프로젝트의 컴포넌트에 어노테이션 적용

## SKILL.md 프론트매터

```yaml
---
name: quickstart
description: agrune 온보딩 스킬. 사용자가 "agrune 시작", "agrune 셋업", "quickstart", "agrune 설치", "어노테이션 시작", "agrune 연동", "agrune 세팅" 등을 말하면 이 스킬을 사용할 것. 전역 인프라 설치 검증, 프로젝트별 플러그인 설치, 어노테이션까지 풀 플로우를 안내한다.
---
```

## 선행 작업 (구현 전 반드시 완료)

quickstart 스킬이 동작하려면 다음이 필요하다:

### 1. agrune-plugin 마켓플레이스 구성

`agrune-plugin` 레포에 `.claude-plugin/marketplace.json` 추가:

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

## 멱등성

스킬은 어느 단계에서 중단되더라도 다시 `/quickstart`를 실행하면 완료된 단계를 스킵하고 남은 단계부터 진행한다.

| 검증 방법 | 대상 |
|-----------|------|
| `node --version` | Node.js 버전 |
| `~/.agrune/version.json` + `doctor` | 전역 인프라 |
| `claude plugin list` | 프로젝트 플러그인 |

## 스킬 위치

`agrune-plugin/skills/quickstart/SKILL.md`

기존 `DRAFT.md`는 SKILL.md 완성 후 삭제.

### 2. annotate 스킬 Vite 플러그인 섹션 제거

현재 annotate 스킬의 "Vite 플러그인 설정 확인" 섹션(SKILL.md 343~365행)은 미구현 기능(`agruneDomPlugin()`, `@agagrune/build-core/register`)을 참조하고 있다. quickstart가 annotate를 체이닝하므로, 이 섹션이 남아있으면 사용자에게 존재하지 않는 패키지 설치를 안내하게 된다. **quickstart 구현 전에 반드시 제거해야 한다.**

(관련: docs/notes/8-annotation-validation-package.md)
