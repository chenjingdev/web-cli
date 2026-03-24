---
name: annotate
description: webcli 어노테이션을 컴포넌트에 자동으로 추가하는 스킬. 사용자가 "어노테이션 달아줘", "이 컴포넌트를 AI가 제어할 수 있게 해줘", "webcli 어노테이션", "annotate", "data-webcli 추가", "이 페이지 전체에 어노테이션", "프로젝트 전체 어노테이션" 등을 말하면 반드시 이 스킬을 사용할 것. 컴포넌트나 페이지의 인터랙티브 요소를 분석하고 적절한 data-webcli-* 속성을 제안/적용하는 모든 작업에 이 스킬이 필요하다.
---

# webcli Annotate

컴포넌트의 인터랙티브 요소를 분석하여 `data-webcli-*` 어노테이션을 자동으로 추가한다.
이 어노테이션이 있어야 AI 에이전트가 브라우저의 DOM 요소를 원격으로 제어할 수 있다.

## 어노테이션 시스템 핵심

### 필수 속성 (모든 타겟 요소에 필요)

| 속성 | 설명 | 정적/동적 |
|------|------|-----------|
| `data-webcli-action` | `"click"` 또는 `"fill"` | **정적만 가능** |
| `data-webcli-name` | 타겟의 표시 이름 | 정적 또는 동적 |
| `data-webcli-desc` | 타겟이 하는 일 설명 | 정적 또는 동적 |

### 선택 속성

| 속성 | 설명 |
|------|------|
| `data-webcli-key` | 명시적 타겟 ID (정적만 가능) |
| `data-webcli-group` | 그룹 ID (여러 타겟을 묶음) |
| `data-webcli-group-name` | 그룹 표시 이름 |
| `data-webcli-group-desc` | 그룹 설명 |
| `data-webcli-sensitive` | `"true"` 시 값 미리보기 숨김 (비밀번호 등) |

### action 결정 규칙

action은 `"click"` 또는 `"fill"` 두 가지뿐이다.

- **`click`**: 버튼, 링크, 탭, 체크박스, 라디오, 토글, 드롭다운 트리거, 메뉴 아이템, **드래그 가능한 요소**, **드롭 대상 요소**
- **`fill`**: input, textarea, contenteditable 요소

드래그 앤 드롭은 별도의 action이 아니라 `drag` **command**로 처리된다. 런타임이 두 개의 `click` 타겟(source, destination)을 받아 pointer 이벤트 시퀀스(pointerdown → pointermove → pointerup)로 드래그를 수행한다. 따라서 드래그 소스와 드롭 대상 모두 `action="click"`으로 어노테이션해야 한다. 자세한 어노테이션 규칙은 아래 **드래그 앤 드롭 어노테이션** 섹션을 참고하라.

### 드래그 앤 드롭 어노테이션

drag command는 `sourceTargetId`(잡을 요소)와 `destinationTargetId`(놓을 요소)와 `placement`(`"before"` | `"inside"` | `"after"`)를 받는다. 두 타겟 모두 `action="click"`이어야 하고, source와 destination은 서로 달라야 하며, 둘 다 snapshot에 존재해야 한다.

#### placement가 결정하는 것

런타임은 destination 요소의 바운딩 박스를 기준으로 포인터를 놓는다:
- **`before`**: destination 상단 가장자리 → destination 앞에 삽입
- **`after`**: destination 하단 가장자리 → destination 뒤에 삽입
- **`inside`** (기본값): destination 중앙 → destination 내부에 삽입

#### 칸반 보드 패턴

DnD가 가장 흔히 쓰이는 UI가 칸반 보드다. 어노테이션해야 하는 요소는 4가지다:

| 요소 | 역할 | name 예시 | desc 예시 |
|------|------|-----------|-----------|
| 카드 (또는 드래그 핸들) | drag source | `{task.title}` (동적) | `"이 카드를 드래그하여 이동"` |
| 컬럼 드롭 영역 | drag destination (컬럼 이동) | `{column.title} 컬럼` (동적) | `"이 컬럼으로 카드를 이동"` |
| 다른 카드 | drag destination (순서 변경) | 카드 자체 name과 동일 | 카드 자체 desc와 동일 |
| 빈 컬럼의 빈 영역 | drag destination (빈 컬럼으로 이동) | `{column.title} 빈 영역` (동적) | `"빈 컬럼에 카드를 놓기"` |

**⚠️ 칸반 보드의 그룹 설계:** 칸반 보드는 반드시 다음 그룹들로 분리해야 한다:
- `kanban-toolbar`: 필터, 정렬, 보기 전환 등 상단 도구 모음
- `kanban-columns`: 모든 컬럼 드롭 영역 + 빈 컬럼 드롭존 (같은 그룹으로 합쳐야 함)
- `kanban-cards`: 드래그 가능한 카드들
- `kanban-card-actions`: 카드 삭제, 편집 등 카드별 액션 버튼

그룹 없이 두면 TUI에서 모든 칸반 액션이 `default` 그룹으로 뭉쳐서 탐색이 불가능해진다. **특히 빈 컬럼 드롭존은 `kanban-columns`와 같은 그룹에 넣어야 한다** — 별도 그룹(`kanban-empty-columns` 등)으로 분리하면 DnD 목적지가 컬럼과 따로 놀아서 탐색 구조가 어색해진다.

**AI가 drag command를 구성하는 방식:**
- "카드를 Done 컬럼으로 이동" → `source=카드, destination=Done 컬럼, placement=inside`
- "카드 B 위에 놓기" → `source=카드, destination=카드B, placement=before`
- "카드 B 아래에 놓기" → `source=카드, destination=카드B, placement=after`
- "빈 컬럼에 놓기" → `source=카드, destination=빈 영역, placement=inside`

#### 드래그 핸들 규칙

UI에 드래그 핸들(grip icon 등)이 따로 있으면 카드 본체가 아니라 **핸들에** 어노테이션한다. 런타임은 source 요소의 중심에서 pointerdown을 발생시키므로, 핸들이 아닌 카드 본체에 달면 실제 드래그가 시작되지 않을 수 있다.

핸들이 없고 카드 전체가 드래그 가능하면 카드 루트 요소에 단다.

#### 빈 컬럼 처리

카드가 하나도 없는 컬럼은 "빈 상태 표시 영역" 또는 컬럼 본체를 별도 drop target으로 어노테이션해야 한다. 이 타겟이 없으면 AI가 빈 컬럼으로 카드를 옮길 수 없다.

#### 전체 예제: 칸반 보드

```tsx
{columns.map(column => (
  <div
    key={column.id}
    data-webcli-group={`column-${column.id}`}
    data-webcli-group-name={column.title}
    data-webcli-group-desc={`${column.title} 컬럼의 카드 목록`}
  >
    <h3>{column.title}</h3>

    {/* 컬럼 자체를 drop target으로 (카드를 이 컬럼으로 이동할 때 사용) */}
    <div
      className="card-list"
      data-webcli-action="click"
      data-webcli-name={`${column.title} 컬럼`}
      data-webcli-desc="이 컬럼으로 카드를 이동"
    >
      {column.tasks.length === 0 ? (
        /* 빈 컬럼일 때 별도 drop target */
        <div
          className="empty-state"
          data-webcli-action="click"
          data-webcli-name={`${column.title} 빈 영역`}
          data-webcli-desc="빈 컬럼에 카드를 놓기"
        >
          No tasks
        </div>
      ) : (
        column.tasks.map(task => (
          <div key={task.id} className="card">
            {/* 드래그 핸들이 있으면 핸들에 어노테이션 */}
            <button
              className="drag-handle"
              data-webcli-action="click"
              data-webcli-name={task.title}
              data-webcli-desc="이 카드를 드래그하여 이동"
            >
              ⠿
            </button>
            <span>{task.title}</span>
          </div>
        ))
      )}
    </div>
  </div>
))}
```

#### DnD 이름 규칙

AI가 snapshot에서 source와 destination을 구분하려면 이름이 명확해야 한다:
- **카드**: 카드의 고유 제목을 그대로 사용 (예: `"로그인 페이지 리디자인"`)
- **컬럼**: `"{컬럼명} 컬럼"` 접미사 (예: `"진행중 컬럼"`, `"Done 컬럼"`)
- **빈 영역**: `"{컬럼명} 빈 영역"` 접미사 (예: `"Done 빈 영역"`)

이렇게 해야 AI가 "로그인 페이지 리디자인을 Done 컬럼으로 옮겨"라는 명령에서 source와 destination을 정확히 매칭할 수 있다.

### 커버리지 원칙: 빠짐없이 달아라

AI 에이전트는 어노테이션이 달린 요소만 제어할 수 있다. 하나라도 빠지면 그 기능은 자동화할 수 없다.

**드롭다운/Select의 옵션 아이템도 반드시 어노테이션 대상이다.** SelectTrigger(드롭다운 열기)뿐 아니라 각 SelectItem/Option에도 개별 어노테이션을 달아야 AI가 특정 옵션을 선택할 수 있다.

```tsx
// 좋은 예: 트리거 + SelectContent 그룹 + 각 옵션 모두 어노테이션
<Select>
  <SelectTrigger
    data-webcli-action="click"
    data-webcli-name="역할 필터"
    data-webcli-desc="역할별 필터 드롭다운 열기"
  >
    <SelectValue placeholder="Role" />
  </SelectTrigger>
  <SelectContent
    data-webcli-group="role-filter-options"
    data-webcli-group-name="역할 필터 옵션"
    data-webcli-group-desc="역할 필터 드롭다운의 선택지"
  >
    <SelectItem value="all"
      data-webcli-action="click"
      data-webcli-name="All Roles"
      data-webcli-desc="모든 역할의 멤버 표시"
    >All Roles</SelectItem>
    <SelectItem value="admin"
      data-webcli-action="click"
      data-webcli-name="Admin"
      data-webcli-desc="Admin 역할 멤버만 필터링"
    >Admin</SelectItem>
  </SelectContent>
</Select>
```

**⚠️ `SelectContent`에 반드시 그룹을 달아야 한다.** 그룹이 없으면 드롭다운 옵션이 상위 그룹에 섞여 노출되어, TUI에서 옵션이 다른 액션들과 뒤섞여 탐색이 어려워진다. 위자드나 폼 안의 드롭다운은 특히 주의하라 — `SelectContent`마다 고유한 그룹 ID를 부여해야 한다 (예: `wizard-status-options`, `wizard-priority-options`, `wizard-assignee-options`).

마찬가지로 **다단계 폼(위자드)**의 각 단계에서 보이는 모든 인터랙티브 요소를 빠짐없이 달아야 한다. 단계별로 그룹을 나누어 구조를 명확히 하라.

### 동적 name/desc 패턴

반복문에서 렌더링되는 컴포넌트는 각 인스턴스를 구분할 수 있도록 동적 name을 사용한다.
컴포넌트의 데이터에서 가장 의미 있는 식별값을 name으로 매핑하라.

```tsx
// 좋은 예: 각 카드의 제목이 name이 된다
{tasks.map(task => (
  <button
    data-webcli-action="click"
    data-webcli-name={task.title}
    data-webcli-desc="태스크 상세 페이지로 이동"
    onClick={() => navigate(task.id)}
  >
    {task.title}
  </button>
))}

// 좋은 예: 테이블 행의 사용자 이름이 name
{members.map(member => (
  <tr data-webcli-group={`member-${member.id}`}>
    <td>
      <button
        data-webcli-action="click"
        data-webcli-name={member.name}
        data-webcli-desc="멤버 프로필 보기"
      >
        {member.name}
      </button>
    </td>
    <td>
      <button
        data-webcli-action="click"
        data-webcli-name={`${member.name} 삭제`}
        data-webcli-desc="멤버를 목록에서 제거"
      >
        삭제
      </button>
    </td>
  </tr>
))}
```

동적 name/desc는 컴파일 시 null로 기록되며, 런타임에서 DOM 속성 값을 직접 읽는다.

### name/desc 작성 가이드

name과 desc는 AI 에이전트가 어떤 요소인지 판단하는 데 쓰인다. 명확하고 구체적으로 작성하라.

**name 규칙:**
- 사용자가 보는 UI 라벨과 일치시킨다 (버튼 텍스트, 메뉴 이름 등)
- 반복 요소는 각 인스턴스를 구분할 수 있는 데이터를 사용한다
- 같은 페이지에서 중복되지 않아야 한다

**desc 규칙:**
- "이 요소를 클릭/입력하면 무슨 일이 생기는가?"에 답하는 문장을 쓴다
- 화면 전환, 상태 변경, API 호출 등 결과를 설명한다
- 반복 요소에서 desc가 동일하면 정적 문자열로 충분하다

## 그룹 설계 원칙

그룹은 관련된 타겟들을 논리적으로 묶는다. 터미널 TUI에서 탐색 단위로 사용된다.

**그룹 경계를 나누는 기준:**
1. **UI 섹션 단위**: 헤더, 사이드바, 메인 콘텐츠, 모달 등
2. **기능 단위**: 검색 영역, 필터 패널, CRUD 폼 등
3. **반복 단위**: 카드 리스트의 각 카드, 테이블의 각 행 (동적 group ID 사용)

**그룹 메타데이터 배치:**
```tsx
{/* 그룹 경계 요소에 group ID + 메타데이터를 함께 둔다 */}
<nav
  data-webcli-group="main-nav"
  data-webcli-group-name="메인 네비게이션"
  data-webcli-group-desc="페이지 간 이동 메뉴"
>
  <button data-webcli-action="click" data-webcli-name="홈" data-webcli-desc="홈 페이지로 이동">홈</button>
  <button data-webcli-action="click" data-webcli-name="설정" data-webcli-desc="설정 페이지로 이동">설정</button>
</nav>
```

그룹이 필요 없는 단순한 경우(버튼 하나, 독립적인 입력 필드)에는 그룹 없이 어노테이션만 추가해도 된다. 컴파일러가 자동으로 `default` 그룹에 배치한다.

## 작업 흐름

### 단일 파일 작업

1. 파일을 읽고 컴포넌트 구조를 파악한다
2. 인터랙티브 요소를 식별한다:
   - onClick, onSubmit 등 이벤트 핸들러가 있는 요소
   - `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>` 등 기본 인터랙티브 HTML 요소
   - 클릭 이벤트가 바인딩된 커스텀 컴포넌트 (단, 최종 DOM 요소에 어노테이션이 전달되어야 함)
   - Radix UI, MUI 등 UI 라이브러리의 인터랙티브 프리미티브
3. 각 요소에 적절한 action, name, desc를 결정한다
4. 반복 렌더링 여부를 확인하고, 반복이면 동적 name을 사용한다
5. 관련 요소들을 그룹으로 묶을지 판단한다
6. 어노테이션을 적용한다

### 프로젝트 전체 작업

사용자가 "전체"를 요청하면:

1. 프로젝트의 페이지/라우트 구조를 파악한다
2. 페이지별로 독립적인 서브에이전트를 사용하여 병렬 처리한다
3. 각 서브에이전트는 해당 페이지의 컴포넌트 트리를 분석하고 어노테이션을 적용한다
4. 완료 후 전체 결과를 요약한다

페이지 수가 많으면 중요도나 사용 빈도가 높은 페이지부터 처리하고, 사용자에게 진행 상황을 알린다.

## Dialog/Modal 닫기 버튼

공통 Dialog 컴포넌트의 닫기 버튼(`DialogPrimitive.Close`, `DialogClose`, X 버튼 등)에 반드시 어노테이션을 달아야 한다. 닫기 버튼에 어노테이션이 없으면 모달이 열려도 AI가 닫기 액션을 수행할 수 없다.

```tsx
// Dialog 공통 컴포넌트에서 닫기 버튼에 어노테이션 추가
<DialogPrimitive.Close
  data-webcli-action="click"
  data-webcli-name="닫기"
  data-webcli-desc="다이얼로그 닫기"
>
  <X className="h-4 w-4" />
</DialogPrimitive.Close>
```

공통 UI 라이브러리 래퍼에서 닫기 버튼을 정의하는 경우, **래퍼 수준에서 한 번만** 어노테이션하면 이를 사용하는 모든 Dialog에 자동 적용된다.

## 어노테이션 대상이 아닌 요소

다음만 제외한다. 이 목록에 없으면 어노테이션 대상이다:
- 순수 표시 요소 (텍스트, 이미지, 아이콘 — 클릭/드래그 이벤트 없음)
- 레이아웃 컨테이너 (div, section — 인터랙션 없음)
- 비활성화된 요소 (disabled 상태가 영구적인 경우)
- 스크롤 영역 자체 (스크롤은 webcli가 다루지 않음)
- 서드파티 임베드 (iframe 내부 요소)

## 다단계 폼/위자드 패턴

단계별 폼이 있을 때:

1. 각 단계를 별도 그룹으로 나눈다 (`wizard-step-basic`, `wizard-step-details` 등)
2. 네비게이션 버튼(이전/다음/제출)은 별도 그룹으로 묶는다
3. 각 단계의 모든 입력 필드, 선택 트리거, 옵션을 빠짐없이 어노테이션한다
4. 리뷰/확인 단계는 표시만 하는 경우 어노테이션이 필요 없다

```tsx
<DialogContent data-webcli-group="task-wizard" data-webcli-group-name="태스크 생성 위자드">
  {step === 0 && (
    <div data-webcli-group="wizard-step-basic" data-webcli-group-name="기본 정보">
      <Input data-webcli-action="fill" data-webcli-name="태스크 이름" data-webcli-desc="새 태스크의 제목 입력" />
      {/* Select + 모든 SelectItem에 어노테이션 */}
    </div>
  )}
  <div data-webcli-group="wizard-navigation" data-webcli-group-name="위자드 네비게이션">
    <Button data-webcli-action="click" data-webcli-name="이전 단계" data-webcli-desc="이전 입력 단계로 돌아가기" />
    <Button data-webcli-action="click" data-webcli-name="다음 단계" data-webcli-desc="다음 입력 단계로 진행" />
  </div>
</DialogContent>
```

## Vite 플러그인 설정 확인

어노테이션이 동작하려면 앱의 `vite.config.ts`에 webcli 플러그인이 등록되어 있어야 한다.
어노테이션을 추가하기 전에 확인하고, 없으면 사용자에게 알린다.

```ts
// vite.config.ts
import webCliDomPlugin from '@webcli-dom/build-core'

export default defineConfig({
  plugins: [
    webCliDomPlugin(),
    // ... 다른 플러그인
  ],
})
```

앱의 엔트리 파일에 런타임 등록도 필요하다:
```ts
// main.ts 또는 main.tsx
import '@webcli-dom/build-core/register'
```
