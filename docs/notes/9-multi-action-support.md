# 복수 액션(Multi-Action) 지원

작성일: 2026-03-26

## 배경

하나의 DOM 요소에 여러 인터랙션이 공존하는 UI 패턴이 흔하다:

| UI 패턴 | 액션 조합 |
|---------|----------|
| 칸반 카드 (drag + 상세보기) | `click` + `dblclick` |
| 테이블 셀 (선택 + 컨텍스트메뉴) | `click` + `contextmenu` |
| 아바타/프로필 (프로필 열기 + 툴팁) | `click` + `hover` |
| 파일 아이콘 (열기 + 더블클릭 편집) | `click` + `dblclick` |

현재 `data-agrune-action`은 단일 문자열만 허용하므로 이런 요소는 하나의 액션만 선택해야 한다. 벤치마크에서 칸반 카드의 `onDoubleClick` 핸들러가 `action="click"`으로만 어노테이션되는 문제가 확인됨.

## 설계

### 어노테이션 문법

쉼표 구분 복수 액션:

```html
<div data-agrune-action="click,dblclick"
     data-agrune-name="카드 제목"
     data-agrune-desc="드래그하여 이동하거나 더블클릭으로 상세 보기">
```

### 스캐너 변경 (`dom-scanner.ts`)

현재:
```typescript
const rawAction = el.getAttribute('data-agrune-action') ?? ''
if (!VALID_ACTION_KINDS.has(rawAction)) return
```

변경:
```typescript
const rawAction = el.getAttribute('data-agrune-action') ?? ''
const actions = rawAction.split(',').map(a => a.trim()).filter(a => VALID_ACTION_KINDS.has(a))
if (actions.length === 0) return
```

- 하나의 요소 → 액션 수만큼 별도 `ScannedTarget`으로 등록
- `targetId` 생성: 단일 액션이면 기존 로직 유지, 복수 액션이면 `{baseId}::{actionKind}` 접미사 추가
- `selector`는 동일 요소를 가리키므로 공유

### 코어 타입 변경 (`core/index.ts`)

```typescript
// PageTarget.actionKind는 여전히 단일 ActionKind (타겟 당 하나)
// 복수 액션은 같은 요소에서 파생된 여러 타겟으로 표현
// → 코어 타입 변경 불필요
```

### MCP 도구 영향

- `agrune_act`: 변경 없음. 이미 `action` 파라미터로 인터랙션 타입을 선택하며, targetId로 특정 액션 타겟을 지정
- `agrune_snapshot`: 같은 요소에서 파생된 복수 타겟이 표시됨. `selector`가 동일하므로 AI가 같은 요소임을 인식 가능
- 그 외 도구: 변경 없음

### 스냅샷 출력 예시

```json
{
  "targets": [
    {
      "targetId": "task-card-1::click",
      "name": "로그인 페이지 리디자인",
      "actionKind": "click",
      "selector": "[data-agrune-name=\"로그인 페이지 리디자인\"]"
    },
    {
      "targetId": "task-card-1::dblclick",
      "name": "로그인 페이지 리디자인",
      "actionKind": "dblclick",
      "selector": "[data-agrune-name=\"로그인 페이지 리디자인\"]"
    }
  ]
}
```

## 변경 범위

### 코어 (`packages/core`)

- [ ] `index.ts` — 변경 없음 확인 (타입은 이미 호환)

### 확장 프로그램 (`packages/extension`)

- [ ] `dom-scanner.ts` — `scanAnnotations()` 수정: 쉼표 split, 복수 타겟 생성, targetId에 `::actionKind` 접미사
- [ ] `dom-scanner.ts` — 단일 액션일 때 기존 targetId 유지 (하위 호환)
- [ ] 단위 테스트 추가: 복수 액션 파싱, 빈 값 무시, 유효하지 않은 값 필터링

### MCP 서버 (`packages/mcp-server`)

- [ ] `tools.ts` — `agrune_act` description에 복수 액션 힌트 추가 (선택)
- [ ] 동작 검증: 복수 타겟 중 하나에 act 요청 시 정상 동작 확인

### 빌드 코어 (`packages/build-core`)

- [ ] 컴파일러가 `data-agrune-action` 값을 쉼표 구분 문자열로 보존하는지 확인

### 플러그인 (`agrune-plugin`)

- [ ] `annotate` 스킬 — 액션 결정 규칙에 복수 액션 문법 추가, 예시 코드 업데이트
- [ ] `quickstart` 스킬 — MCP 도구 테이블에 복수 액션 언급 (선택)

### 데모 (`agrune-demo`)

- [ ] `KanbanBoard.tsx` — 칸반 카드에 `data-agrune-action="click,dblclick"` 적용하여 검증

## 엣지 케이스

- 동일 액션 중복: `"click,click"` → 중복 제거하여 단일 타겟
- 빈 문자열/공백: `"click, , dblclick"` → 빈 항목 무시
- `fill` + 다른 액션: `"fill,click"` → 허용. fill 타겟과 click 타겟이 별도 등록. `agrune_act`는 fill 타겟에 거부하는 기존 로직 유지
- `data-agrune-key`가 있는 복수 액션: `key="my-card"` → `my-card::click`, `my-card::dblclick`
- 단일 액션일 때 `::` 접미사 없음 → 기존 프로젝트 하위 호환

## 현재 상태

완료. 배열 방식(`actionKinds: ActionKind[]`)으로 구현됨.
- 설계: `docs/superpowers/specs/2026-03-26-multi-action-support-design.md`
- 원래 노트의 타겟 분리(`::` 접미사) 방식 대신 단일 타겟 + actionKinds 배열 방식 채택
