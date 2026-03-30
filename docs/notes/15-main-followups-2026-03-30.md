# main 기준 후속 작업

작성일: 2026-03-30  
검토 기준: `origin/main` @ `1ac4a55`

## 제품 방향 재확인

`agrune`은 플랫폼에 에이전트가 붙어서 자동화를 도와주는 도구다.

- 사용이 어려운 플랫폼에서 가이드 역할 수행
- E2E QA 자동화
- 반복적이고 귀찮은 플랫폼 작업 자동화

따라서 우선순위는 "입력 신뢰성", "런타임 부팅 안정성", "복구력"이다.

## 최우선

### 1. `fill` 입력 경로를 CDP 기반으로 통일

현재 클릭/드래그/휠은 CDP 입력 시퀀스를 사용하지만, `fill`은 여전히 DOM value setter + `input/change` 이벤트에 의존한다.

이 상태의 문제:

- React controlled input, keydown 기반 로직, 마스킹 입력, 에디터류에서 신뢰성이 떨어진다
- 입력 계층이 둘로 갈라져 디버깅이 어렵다
- QA 자동화 관점에서 실제 사용자 입력과 차이가 난다

해야 할 일:

- `event-sequences`에 텍스트 입력용 CDP 시퀀스 추가
- `fill` 핸들러를 CDP 기반 입력으로 전환
- `input`, `textarea`, `contenteditable`, `select`를 구분해서 처리
- 필요한 경우 `select`는 현재 방식 유지, 나머지는 CDP 입력 우선

완료 기준:

- `fill`이 DOM synthetic 방식이 아니라 CDP 입력을 기본 경로로 사용한다
- controlled input과 contenteditable 케이스 테스트가 추가된다

## 바로 고칠 버그

### 2. 런타임 부팅 조건을 `data-agrune-action` 전용에서 `data-agrune-*` 전반으로 확장

현재 content bootstrap은 `[data-agrune-action]`이 있어야만 런타임을 띄운다.

하지만 현재 코드베이스에는 다음처럼 action 외의 어노테이션도 실제로 런타임 동작에 사용된다.

- `data-agrune-group`
- `data-agrune-canvas`
- `data-agrune-meta`

이 상태의 문제:

- group/canvas/meta만 있는 페이지에서 런타임이 아예 안 뜰 수 있다
- 전략 문제가 아니라 단순 부팅 조건 버그다

해야 할 일:

- `packages/extension/src/content/index.ts`의 부팅 조건 수정
- 관련 테스트 추가

완료 기준:

- `data-agrune-action`이 없어도 관련 `data-agrune-*`가 있으면 런타임이 부팅된다

## 안정성

### 3. self-healing 보강

현재는 native host/extension 쪽 연결이 끊기면 일부 흐름이 타임아웃 의존으로 남아 있다.

대표 문제:

- `CommandQueue`가 sender loss를 즉시 실패 처리하지 않고 timeout까지 기다릴 수 있음
- extension reload/context invalidation 이후 복구 경로가 약함
- native host 재연결과 command 복구가 분리돼 있음

해야 할 일:

- sender disconnect 시 pending command 즉시 실패 처리
- extension context invalidation 후 재부팅/재동기화 경로 보강
- native host 재연결 직후 resync 자동 수행
- 안전한 명령에 한해 1회 자동 재시도 여부 검토

완료 기준:

- 연결 손실 시 30초 timeout 대신 즉시 원인 있는 에러가 반환된다
- extension reload 이후 새로고침 또는 resync로 자연 복구되는 경로가 분명해진다

## 다음 우선순위

### 4. active session 선택과 포커스 정책 정리

현재 기본 탭 선택은 사실상 첫 세션 기반이라 오조작 위험이 있다.

필요한 것:

- active session 개념 도입
- 최근 상호작용 탭 우선
- 사용자가 명시 선택한 탭 우선
- 필요 시 대상 탭/창 포커스 전환

이건 가이드/QA/반복 작업 자동화 모두에서 실사용성을 크게 올린다.

## 범위 밖

다음 항목은 지금 우선순위로 보지 않는다.

- 어노테이션 없는 페이지까지 범용 런타임 확장
- 권한 모델 축소/재설계

현재 제품은 `data-agrune-*`가 붙은 플랫폼을 전제로 한다.
