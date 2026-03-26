# 설계 원칙

## 제품 방향

- 제품의 주 제어 표면은 `MCP`로 본다.
- 설치/진단용 운영 도구는 핵심 제품 표면이 아니라 보조 수단으로 취급한다.
- 브라우저 조작 능력은 `extension + native host + backend daemon + MCP` 조합으로 제공한다.
- 장기적으로는 QA 자동화까지 고려해, 단순 클릭 도구가 아니라 상태 기반 브라우저 런타임으로 발전시킨다.
- 에이전트가 페이지를 분석하려면 어노테이션된 타겟 외에 visible content도 읽을 수 있어야 한다. `agrune_read`는 어노테이션 시스템과 독립적으로 동작한다.

## 스냅샷 상태 변화

- 페이지 전환 시 새 페이지 기준으로 스냅샷 버전이 바뀌어야 한다.
- 같은 탭이 새 URL로 열리면 이전 snapshot cache는 stale 상태로 보고 비워야 한다.
- 모달/오버레이가 떠 있으면 기본 스냅샷은 배경 요소가 아니라 오버레이 내부의 actionable targets만 보여줘야 한다.
- 모달 컨텍스트에는 클릭만이 아니라 입력 가능한 필드(`fill`)도 포함해야 한다.
- 액션은 가능한 한 `expectedVersion`을 함께 사용해 stale snapshot 사용을 막는다.

## 모달/오버레이

- 오버레이가 활성화되면 배경 타깃 액션은 차단한다.
- MCP도 같은 원칙을 따라, 기본 스냅샷에서는 배경 타깃을 숨긴다.
- QA 자동화 관점에서도 `현재 포커스된 상호작용 영역`만 노출하는 것이 더 안정적이다.

## 액션 타입

- ActionKind는 `click`, `fill`, `dblclick`, `contextmenu`, `hover`, `longpress`를 지원한다.
- `agrune_act`의 `action` 파라미터로 인터랙션 타입을 선택한다. 기본값은 `click`.
- 어노테이션의 `actionKind`는 LLM에게 요소의 주요 인터랙션을 알려주는 힌트이며, 에이전트는 다른 action을 보낼 수 있다. 단 `fill` 타겟에는 act 커맨드를 거부한다.
- `select`(fill 또는 click+click으로 대체), `toggle`(click과 동일), `keypress`(요소 중심 모델에 부적합), `focus`(다른 액션에서 암시적)는 제외했다.
- 하나의 요소에 복수 인터랙션이 공존하는 경우(drag+dblclick, click+contextmenu 등) 쉼표 구분 복수 액션을 지원한다 (`data-agrune-action="click,dblclick"`). 상세 설계: `docs/notes/9-multi-action-support.md`.

## 페이지 콘텐츠 읽기

- `agrune_read`는 페이지 visible content를 마크다운으로 변환하여 반환한다.
- 어노테이션이 없는 페이지에서도 동작한다 (어노테이션 시스템과 독립).
- CSS 셀렉터로 추출 범위를 지정할 수 있다.
- 출력은 50,000자로 제한되며, 초과 시 truncation 메시지가 추가된다.
- `read` 어노테이션은 도입하지 않았다 — 모든 텍스트가 읽기 대상이라 경계가 모호하고 AI 자동 어노테이션 규칙 수립이 어렵기 때문.
