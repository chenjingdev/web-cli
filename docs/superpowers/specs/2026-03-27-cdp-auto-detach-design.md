# CDP 디버거 자동 해제 설계

## 배경

CDP 디버거가 연결되면 Chrome 상단에 "agrune에서 이 브라우저에 대한 디버깅을 시작함" info bar가 표시된다. 현재는 탭을 닫거나 사용자가 수동으로 닫기 전까지 계속 남아있다.

## 목표

MCP 도구 호출 활동이 없으면 자동으로 CDP 디버거를 해제하여 info bar를 소멸시킨다. 단, AI 에이전트가 작업 중일 때는 유지한다.

## 핵심 아이디어

CDP 요청뿐 아니라 **모든 MCP 활동**(command_request, cdp_request)을 활동 신호로 사용한다. AI가 추론 중에도 `agrune_snapshot` 등 비-CDP 도구를 호출하므로, 이를 활동 신호로 인식하면 "아직 일하는 중"인 상태를 더 정확하게 판단할 수 있다.

## 설계

### cdp-handler.ts 변경

- `idleTimers: Map<number, ReturnType<typeof setTimeout>>` — 탭별 idle 타이머
- `IDLE_TIMEOUT_MS = 120_000` (2분)
- `notifyActivity(tabId: number)`: 해당 탭의 idle 타이머를 리셋. CDP가 연결된 탭에만 적용.
- `handleRequest()` 내부에서 `notifyActivity()` 호출
- 타이머 만료 시 `detach(tabId)` 호출
- `detach()` 시 해당 탭 타이머 정리
- `CdpHandler` 인터페이스에 `notifyActivity` 추가

### message-router.ts 변경

- `cdpHandler` 옵션 타입에 `'notifyActivity'` 추가: `Pick<CdpHandler, 'handleRequest' | 'notifyActivity'>`
- `handleNativeHostMessage`의 `command_request` 케이스에서 `cdpHandler.notifyActivity(tabId)` 호출

### service-worker.ts

변경 없음. `createCdpHandler`와 `createBackgroundMessageRouter` 호출부는 인터페이스가 호환되므로 수정 불필요.

## 동작 흐름

```
MCP 도구 호출 → command_request → message-router → notifyActivity(tabId) → 타이머 리셋 (2분)
                                                  → 명령 실행 → CDP 필요 시 handleRequest → 타이머 또 리셋
2분 무활동 → 타이머 만료 → detach(tabId) → info bar 소멸
다음 요청 → ensureAttached() → 자동 재연결 → info bar 재표시
```

## 검증

1. `agrune_act` 실행 → info bar 표시
2. 2분 대기 → info bar 자동 소멸
3. `agrune_act` 재실행 → info bar 재표시 → 정상 동작
4. 연속 MCP 호출(추론 시간 포함) 중에는 info bar 유지
