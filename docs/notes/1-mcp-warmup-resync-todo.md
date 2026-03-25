# MCP Warm-up / Resync TODO

작성일: 2026-03-24

## 문제

- backend daemon이 재기동되면 in-memory session/snapshot 상태가 비어진다.
- 현재 content script는 초기 진입 시점에만 `session_open`을 보내고, 이후에는 주기적으로 `snapshot`만 보낸다.
- 이 상태에서 cold start 직후 첫 `agrune_snapshot` 호출은 빈 결과나 에러를 돌려줄 수 있다.

## 목표

- `agrune_snapshot` 첫 호출에서 빈 스냅샷을 바로 반환하지 않는다.
- 시스템이 내부적으로 `warm-up/resync`를 수행한 뒤, 사용 가능한 session/snapshot이 준비되면 그 결과를 반환한다.
- 준비 제한 시간 안에 복구가 안 될 때만 명확한 에러를 반환한다.

## 웜업 동안 서버가 하는 일

warm-up 중 서버는 무거운 계산을 하는 것이 아니라, 브라우저 상태를 다시 모으고 command 경로가 살아 있는지 확인하는 orchestration 역할을 맡는다.

1. MCP 진입점이 backend daemon 존재 여부를 확인하고, 없으면 기동한다.
2. backend는 native host 연결 상태를 확인한다.
3. backend 또는 background가 `resync`를 트리거한다.
4. 활성 탭들이 `session_open`을 다시 보내고, 첫 snapshot을 즉시 또는 빠르게 보낸다.
5. backend는 들어온 `session_open`/`snapshot_update`를 메모리 캐시에 다시 채운다.
6. 준비가 끝나면 그때 `agrune_snapshot` 또는 후속 command 응답을 반환한다.

즉 warm-up은 "빈 캐시를 들고 기다리는 시간"이 아니라 "브라우저 상태 캐시를 다시 채우는 준비 단계"로 정의해야 한다.

## 왜 느리게 느껴지는가

- 현재 `agrune_snapshot`은 snapshot이 없으면 바로 실패한다.
- 첫 snapshot도 즉시 밀어넣지 않고 주기 루프에 의존한다.
- `act` 계열 command timeout이 길어서, 한 번 실패하면 체감 지연이 크게 늘어난다.
- backend 재기동이나 확장 재연결 뒤에 활성 탭이 상태를 다시 밀어주는 explicit `resync`가 없다.

이 네 가지가 겹치면 유저 입장에서는 "한참 기다려야 겨우 다시 붙는 것 같다"는 체감이 생긴다.

## 해야 할 일

1. backend cold start 또는 native host 재연결 직후 `resync` 단계를 정의한다.
2. background/content script가 활성 탭들의 `session_open`을 다시 보내는 경로를 만든다.
3. `session_open` 이후 첫 snapshot을 빠르게 확보하도록 즉시 snapshot 요청 경로를 만든다.
4. `agrune_snapshot` 진입 전에 `ensureReady` 같은 준비 단계를 두고, 짧은 시간 동안 warm-up 완료를 기다리게 한다.
5. `agrune_act`, `agrune_fill`, `agrune_drag`, `agrune_wait`도 같은 준비 단계를 타야 하는지 검토한다.

## 개선 계획

### 1단계: cold start 체감 개선

- `runtime_ready` 직후 첫 `request_snapshot`을 즉시 1회 보낸다.
- `agrune_snapshot` 앞단에 `ensureReady`를 두고, 짧은 시간 동안 warm-up 완료를 기다린다.
- cold start 구간의 command timeout 전략을 별도로 검토한다.

### 2단계: explicit resync 도입

- backend 재기동 또는 native host 재연결 시 `resync` 메시지 흐름을 정의한다.
- background가 활성 탭 또는 주입된 content script들에게 재등록을 요청한다.
- content script는 `session_open`과 첫 snapshot을 다시 보내도록 만든다.

### 3단계: tool 의미 정리

- `agrune_snapshot`의 의미를 "현재 캐시를 그대로 보여준다"가 아니라 "사용 가능한 snapshot을 준비해 반환한다"로 바꾼다.
- `agrune_act`, `agrune_fill`, `agrune_drag`, `agrune_wait`도 필요 시 같은 준비 단계를 거치도록 통일한다.

### 4단계: lifecycle 최적화

- idle shutdown을 도입하더라도 warm-up/resync가 확실히 동작하는 상태를 먼저 만든다.
- 이후에는 "첫 사용 시 자동 기동 -> 짧은 warm-up -> 유휴 시 종료" 흐름을 자연스럽게 만든다.

## 완료 기준

- backend를 내린 뒤 다시 띄워도 첫 `agrune_snapshot`이 빈 응답 없이 정상 결과를 돌려준다.
- 준비 중에는 무한 대기하지 않고, timeout 시 원인이 드러나는 에러를 반환한다.
- agent 프롬프트나 수동 재시도 없이 시스템 내부 로직만으로 cold start를 흡수한다.

## 비목표

- 상위 에이전트 프롬프트에 "다시 호출하라"는 규칙을 넣어 해결하지 않는다.
- 빈 스냅샷을 정상 응답으로 먼저 보내고, 이후 재호출에 의존하지 않는다.
