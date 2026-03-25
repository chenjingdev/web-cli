# 확장프로그램 추가 개선 아이디어

작성일: 2026-03-24

## 목적

Chrome 확장프로그램 관점의 추가 개선 아이디어를 별도 문서로 정리한다. 작업 중인 메인 개선 문서와 분리해서, 확장 기능 후보와 우선순위를 독립적으로 관리하는 용도다.

## 현재 상태

현재 확장프로그램은 다음 정도만 제공한다.

- native host 연결 상태 표시
- native host 재연결
- 전역 런타임 설정 토글(`pointerAnimation`, `auroraGlow`, `autoScroll`, `clickDelayMs`, `auroraTheme`)

이 상태로도 기본 데모는 가능하지만, 실제 운영 도구로 쓰려면 확장프로그램 자체의 제어/진단 능력을 더 올릴 필요가 있다.

## 우선순위 높은 후보

1. 탭/창 포커스 전환
2. 세션 선택기
3. 명령 로그와 실패 원인 표시
4. 타깃 인스펙터

## 1. 탭/창 포커스 전환

- 현재 구조는 특정 `tabId`로 명령을 보낼 수 있지만, 그 탭을 활성화하지는 않는다.
- `agrune_act`, `agrune_fill`, `agrune_drag`, `agrune_guide` 실행 전에 선택적으로 탭을 활성화할 수 있으면 실사용성이 크게 오른다.
- 같은 창 안에서는 `chrome.tabs.update(tabId, { active: true })`, 다른 창까지 포함하면 `chrome.windows.update(windowId, { focused: true })` 계열을 검토한다.
- 목표 UX는 "내가 다른 탭을 보고 있어도, 에이전트가 대상 탭으로 전환한 뒤 조작"이다.
- 이 기능은 자동화 신뢰성뿐 아니라 사용자의 정신 모델과도 잘 맞는다.

## 2. 세션 선택기

- 현재 기본 tab 선택이 단순히 첫 번째 세션이면 오조작 위험이 있다.
- 팝업 또는 side panel에서 현재 열려 있는 `agrune` 세션 목록을 보여주고, "현재 제어 대상"을 명시적으로 고를 수 있어야 한다.
- 세션 항목에는 최소한 `tabId`, `title`, `url`, snapshot 존재 여부 정도를 노출한다.
- 기본 대상 세션을 확장에서 선택할 수 있으면 MCP 호출에서 `tabId`를 매번 넘기지 않아도 된다.

## 3. 명령 로그와 실패 원인 표시

- 현재 구조에는 `TARGET_NOT_FOUND`, `STALE_SNAPSHOT`, `NOT_VISIBLE`, `DISABLED`, `FLOW_BLOCKED` 등 실행 실패 이유가 이미 모델링돼 있다.
- 하지만 사용자는 마지막으로 어떤 명령이 어떤 탭에 보내졌고 왜 실패했는지 한눈에 보기 어렵다.
- 팝업이나 side panel에서 최근 명령, 대상 `tabId`, `targetId`, 결과 코드, snapshot version을 보여주면 디버깅 효율이 크게 오른다.
- 이 기능은 데모용이 아니라 실제 운영/지원 도구로서 필수에 가깝다.

## 4. 타깃 인스펙터

- 현재 페이지에서 수집된 그룹/타깃을 사람이 직접 볼 수 있게 해주는 UI가 필요하다.
- 최소 노출 정보는 `groupId`, `groupName`, `targetId`, `actionKind`, `visible`, `enabled`, `reason`, `textContent` 정도다.
- "왜 지금 클릭할 수 없는지"를 확장에서 바로 확인할 수 있으면, MCP 응답만 보고 추측하는 시간을 크게 줄일 수 있다.
- 단순 팝업보다 넓은 화면이 필요한 기능이라 side panel과 궁합이 좋다.

## 다음 단계 후보

- 도메인별 설정: 전역 설정 한 벌이 아니라 사이트/도메인별 `clickDelayMs`, `autoScroll`, `pointerAnimation`을 저장
- 어노테이션 헬퍼: 선택한 DOM 요소에 대해 `data-agrune-*` 후보, selector, 이름 추천을 제공
- 개발자 진단 화면: native host 상태, backend 연결 여부, session 수, 마지막 오류를 묶어 보여주는 진단 패널

## 정리

- 확장프로그램 기능은 "꾸미기"보다 "제어 대상 선택", "포커스 전환", "실패 진단"을 먼저 강화해야 한다.
- 우선순위는 `탭/창 포커스 전환 -> 세션 선택기 -> 명령 로그 -> 타깃 인스펙터` 순서로 본다.
- 타깃 인스펙터와 명령 로그가 커지기 시작하면, popup 중심 구조보다 side panel 중심 구조를 검토하는 편이 낫다.
