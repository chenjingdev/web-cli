# Multi-Action Support Design

작성일: 2026-03-26

## 목적

하나의 DOM 요소에 여러 인터랙션이 공존하는 UI 패턴(칸반 카드의 click + dblclick 등)을 지원한다. 현재 `data-agrune-action`은 단일 문자열만 허용하여 하나의 액션만 선택 가능하다.

## 핵심 결정

| 결정 | 선택 | 이유 |
|------|------|------|
| 타겟 모델 | 하나의 타겟에 actionKinds 배열 | 스냅샷 토큰 절감, LLM이 같은 요소임을 추론할 필요 없음 |
| 필드명 | `actionKind` → `actionKinds` | 타입 변경 시 이름도 변경하여 마이그레이션 실수 방지 |
| desc | 단일 desc, 자연어로 모든 액션 커버 | 어노테이션 문법 단순 유지 |
| 마이그레이션 | 일괄 변경 | 외부 소비자 없는 내부 프로젝트, 타입 체커로 누락 검출 가능 |
| 범위 | Extension + Build-core 동시 | 점진적 마이그레이션 불필요 |
| fill 조합 | `fill` + 다른 액션 허용 | `agrune_act`는 act 호환 액션만, `agrune_fill`은 fill 타겟만 |

## 어노테이션 문법

기존 `data-agrune-action` 속성에 쉼표 구분 문자열 허용:

```html
<!-- 단일 (기존 호환) -->
<div data-agrune-action="click"
     data-agrune-name="버튼"
     data-agrune-desc="클릭하여 실행">

<!-- 복수 (신규) -->
<div data-agrune-action="click,dblclick"
     data-agrune-name="카드"
     data-agrune-desc="클릭으로 선택, 더블클릭으로 상세 보기">
```

파싱 규칙:
- 쉼표로 구분, 공백 허용 (`"click, dblclick"` OK)
- 중복 제거 (`"click,click"` → `["click"]`)
- 유효하지 않은 값 무시 (`"click,invalid,dblclick"` → `["click","dblclick"]`)
- 빈 항목 무시 (`"click,,dblclick"` → `["click","dblclick"]`)
- 유효 액션 0개 → 타겟 미등록

## 코어 타입 변경 (`packages/core/src/index.ts`)

```typescript
// Before
actionKind: ActionKind

// After
actionKinds: ActionKind[]
```

영향받는 타입:
- `PageTarget.actionKinds`
- `ScannedTarget.actionKinds` (extension)
- `TargetDescriptor.actionKinds` (build-core)

`ActCommandRequest`의 `action` 파라미터는 그대로 유지 — 실행할 액션 하나를 지정하는 용도.

단일 액션도 `["click"]`으로 표현. 배열이 비어있으면 안 됨.

## Extension DOM 스캐너 (`packages/extension/src/content/dom-scanner.ts`)

```typescript
// Before
const rawAction = el.getAttribute('data-agrune-action') ?? ''
if (!VALID_ACTION_KINDS.has(rawAction)) return
const action = rawAction as ActionKind

// After
const rawAction = el.getAttribute('data-agrune-action') ?? ''
const actionKinds = [...new Set(
  rawAction.split(',').map(a => a.trim()).filter(a => VALID_ACTION_KINDS.has(a))
)] as ActionKind[]
if (actionKinds.length === 0) return
```

`ScannedTarget` 생성 시 `actionKinds` 배열을 넣음. targetId는 변경 없음 — 하나의 요소 = 하나의 타겟.

## Build-core 변경

### 매니페스트 파서 (`collectDescriptors`)

```typescript
// Before
actionKind: tool.action as ActionKind

// After
actionKinds: [...new Set(
  tool.action.split(',').map(a => a.trim()).filter(a => VALID_ACTIONS.has(a))
)] as ActionKind[]
```

### Act 핸들러 가드

```typescript
// Before
if (!ACT_COMPATIBLE_KINDS.has(descriptor.actionKind))

// After — 타겟이 act 호환 액션을 하나라도 가지는지
if (!descriptor.actionKinds.some(k => ACT_COMPATIBLE_KINDS.has(k)))
```

실행할 action이 타겟의 actionKinds에 포함되는지 검증:

```typescript
const action = input.action ?? 'click'
if (!descriptor.actionKinds.includes(action as ActionKind)) {
  return buildErrorResult(..., `target does not support action: ${action}`)
}
```

## MCP 도구 영향

### `agrune_snapshot` 출력

```json
{
  "targets": [
    {
      "targetId": "my-card-1",
      "name": "로그인 리디자인",
      "actionKinds": ["click", "dblclick"],
      "description": "클릭으로 선택, 더블클릭으로 상세 보기"
    }
  ]
}
```

### `agrune_act`

변경 없음. 기존대로 `targetId` + `action` 파라미터. description에 복수 액션 힌트 추가.

### `agrune_fill`

변경 없음. `actionKinds`에 `fill`이 포함된 타겟에서 동작.

### 그 외 도구

`agrune_drag`, `agrune_read`, `agrune_wait` 등 변경 없음.

## 테스트

### Extension (`dom-scanner.spec.ts`)

- 쉼표 구분 복수 액션 파싱 (`"click,dblclick"` → `["click","dblclick"]`)
- 중복 제거 (`"click,click"` → `["click"]`)
- 유효하지 않은 값 필터링 (`"click,invalid"` → `["click"]`)
- 빈 항목 무시 (`"click,,dblclick"`)
- 공백 허용 (`"click, dblclick"`)
- 단일 액션 하위 호환 (`"click"` → `["click"]`)

### Build-core (`runtime.spec.ts`)

- 복수 actionKinds 타겟에 act 요청 시 해당 액션 실행
- actionKinds에 없는 액션 요청 시 에러
- `fill` + `click` 조합 타겟에서 `agrune_act(action: "click")` 허용

### MCP (`tools.spec.ts`)

- 스냅샷 출력에 `actionKinds` 배열 포함 확인

## 플러그인 문서 업데이트

### `annotate` 스킬

- 액션 문법에 쉼표 구분 복수 액션 설명 추가
- 예시 코드에 `data-agrune-action="click,dblclick"` 추가
- desc 작성 가이드: 복수 액션일 때 각 액션이 뭘 하는지 자연어로 기술

### `quickstart` 스킬

- MCP 도구 테이블에 `actionKinds` 배열 언급

## 데모 검증

`KanbanBoard.tsx`에 `data-agrune-action="click,dblclick"` 적용하여 검증.

## 엣지 케이스

| 입력 | 결과 | 비고 |
|------|------|------|
| `"click"` | `["click"]` | 기존 호환 |
| `"click,dblclick"` | `["click","dblclick"]` | 정상 |
| `"click, dblclick"` | `["click","dblclick"]` | 공백 trim |
| `"click,click"` | `["click"]` | 중복 제거 |
| `"click,,dblclick"` | `["click","dblclick"]` | 빈 항목 무시 |
| `"click,invalid"` | `["click"]` | 유효하지 않은 값 무시 |
| `"invalid"` | 스킵 | 유효 액션 0개 → 타겟 미등록 |
| `"fill,click"` | `["fill","click"]` | act는 click만, fill은 agrune_fill로 |
