# 개선사항 정리

작성일: 2026-03-24

## 목적

최근 대화에서 정리된 제품/런타임/MCP 개선 방향을 문서로 고정한다. 이 문서는 구현 방향, 우선순위, 후속 작업의 기준점으로 사용한다.

## 제품 방향

- 제품의 주 제어 표면은 `CLI`가 아니라 `MCP`로 본다.
- 사람용 CLI는 브라우저 제어 표면이 아니라 설치/진단/운영 보조 표면으로 제한한다.
- 브라우저 조작 능력은 `extension + native host + backend daemon + MCP` 조합으로 제공한다.
- 장기적으로는 QA 자동화까지 고려해, 단순 클릭 도구가 아니라 상태 기반 브라우저 런타임으로 발전시킨다.

## 스냅샷 방향

### 기본 원칙

- 스냅샷은 전체 페이지 덤프가 아니라 `현재 조작 가능한 컨텍스트`를 보여줘야 한다.
- 기본 스냅샷은 그룹 outline 위주로 반환하고, 상세 타깃은 필요할 때만 펼친다.
- 페이지 전환, 모달 활성화, 오버레이 활성화 등 상태 변화가 생기면 이전 스냅샷을 계속 신뢰하면 안 된다.

### 현재 합의된 형태

- `rune_snapshot()` 기본값은 그룹 outline만 반환한다.
- `rune_snapshot({ groupId })` 또는 `rune_snapshot({ groupIds })`는 필요한 그룹만 펼친다.
- `rune_snapshot({ mode: "full" })`은 현재 active context의 actionable targets 전체를 반환한다.
- 응답에는 `context: "page" | "overlay"`를 포함해 현재 컨텍스트를 드러낸다.
- 그룹 summary는 다음 정도만 포함한다.
  - `groupId`
  - `groupName`
  - `targetCount`
  - `actionKinds`
  - `sampleTargetNames`

### 상태 변화 시 동작

- 페이지 전환 시 새 페이지 기준으로 스냅샷 버전이 바뀌어야 한다.
- 같은 탭이 새 URL로 열리면 이전 snapshot cache는 stale 상태로 보고 비워야 한다.
- 모달/오버레이가 떠 있으면 기본 스냅샷은 배경 요소가 아니라 오버레이 내부의 actionable targets만 보여줘야 한다.
- 모달 컨텍스트에는 클릭만이 아니라 입력 가능한 필드(`fill`)도 포함해야 한다.
- 액션은 가능한 한 `expectedVersion`을 함께 사용해 stale snapshot 사용을 막는다.

## 토큰 최적화 방향

현재 구조는 이전보다 훨씬 낫지만, 아직 토큰을 더 줄일 수 있다.

### 다음 최적화 후보

1. MCP 응답의 pretty JSON 제거
2. `groupId/groupIds` 요청 시 선택한 그룹만 summary에 포함
3. 타깃의 기본값 생략
4. 빈 문자열 필드 생략
5. 액션 결과에서 전체 스냅샷 대신 `snapshotVersion`과 필요한 최소 변경 정보만 반환
6. 장기적으로는 text JSON 대신 structured content 검토

### 생략 우선순위가 높은 값

- `visible: true`
- `enabled: true`
- `reason: "ready"`
- `description: ""`
- 단일 그룹 응답에서 반복되는 `groupName`, `groupDesc`

## 세션/탭 선택 개선

- 기본 tab 선택이 단순히 첫 번째 세션이면 실사용성이 떨어진다.
- 기본 선택은 다음 우선순위를 검토한다.
  1. snapshot이 있는 세션
  2. 가장 최근에 상호작용한 세션
  3. 명시적으로 선택된 세션
- 세션 목록 응답은 요약 정보만 유지한다.

## 모달/오버레이 흐름

- 오버레이가 활성화되면 배경 타깃 액션은 차단한다.
- MCP도 같은 원칙을 따라, 기본 스냅샷에서는 배경 타깃을 숨긴다.
- QA 자동화 관점에서도 `현재 포커스된 상호작용 영역`만 노출하는 것이 더 안정적이다.

## 확장프로그램 업데이트 UX

현재 개발 흐름에서는 확장프로그램을 삭제했다가 다시 올리는 비용이 크다. 이 흐름은 상용 제품 UX로 가져가면 안 된다.

### 개발 환경에서의 목표

- `재설치` 대신 `reload + 탭 새로고침`
- native host 재연결과 extension code reload를 분리
- 설치기는 로드 중인 unpacked extension 디렉터리를 통째로 지우지 않도록 개선

### 상용 환경에서의 목표

- 확장프로그램은 스토어 배포 또는 관리형 배포 기준으로 자동 업데이트
- native host/backend와 extension 간 버전 스큐를 허용하는 호환성 전략 필요
- 정상 업데이트 경로에서 사용자에게 재설치 요구 금지

## CLI와 MCP 역할 분리

- `MCP`는 제품의 실제 제어 표면이다.
- 사람용 CLI가 다시 필요하다면 다음 수준으로 제한한다.
  - `install`
  - `doctor`
  - `status`
  - `reconnect`
  - `logs`
- `act`, `fill`, `drag`, `wait` 같은 브라우저 제어 명령은 MCP에만 둔다.

## 네이밍 방향

- 기존 이름 `webcli`는 제품 본질과 어긋났고, 현재 리브랜딩 방향은 `rune`으로 확정됐다.
- `rune`은 `CLI`나 `MCP`에 묶이지 않는 추상적 브랜드형 이름이라는 점에서 방향이 맞다.
- 이후 작업은 이름 선정이 아니라 `rune` 표기의 일관성과 잔여 `webcli` 문자열 제거에 집중한다.

## 다음 작업 제안

1. `rune_snapshot` 응답 compact JSON화
2. `groupId/groupIds` 응답에서 선택 그룹만 summary 반환
3. default 값 생략 규칙 적용
4. default tab selection 개선
5. dev extension 업데이트 흐름을 `재설치`에서 `reload + refresh`로 변경
6. 모달이 실제로 열린 상태에서 `context: "overlay"` 동작을 E2E 테스트로 고정
