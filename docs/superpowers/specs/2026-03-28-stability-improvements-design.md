# 안정성 고도화 설계

## 개요

agrune MCP 도구 사용 시 안정성과 일관성을 개선하는 두 가지 항목.

1. **디버거 툴바 일관성** — 모든 MCP 호출 시 CDP attach
2. **휠 액션 최적화** — 부드러운 줌을 한 번의 호출로 가능하게

---

## 1. 디버거 툴바 일관성

### 문제

현재 CDP attach는 이벤트 디스패치(`Input.dispatchMouseEvent` 등)가 발생할 때만 lazy하게 실행됨. `agrune_snapshot`, `agrune_sessions`, `agrune_read`, `agrune_config` 등 읽기 전용 도구는 CDP를 거치지 않아 디버거 툴바가 뜨지 않음.

사용자 입장에서 "agrune이 활성 상태인지" 알 수 없고, 도구별로 동작이 달라 혼란을 줌.

### 목표

첫 MCP 도구 호출 시점에 CDP attach가 발생하여, agrune 사용 중에는 항상 디버거 툴바가 표시되도록 한다.

### 설계

**변경 위치:** `packages/extension/src/background/message-router.ts`

현재 `command_request` 수신 시 `cdpHandler.notifyActivity(tabId)`만 호출하고, 실제 attach는 `cdp_request`가 돌아올 때 `cdpHandler.handleRequest()` → `ensureAttached()`에서 발생.

변경: `command_request` 수신 시점에 `cdpHandler.ensureAttached(tabId)`를 직접 호출.

```
command_request 수신
  ├─ cdpHandler.ensureAttached(tabId)   ← 추가
  ├─ cdpHandler.notifyActivity(tabId)   ← 기존 (idle timer 리셋)
  └─ broadcaster.sendToTab(tabId, msg)  ← 기존
```

### 예외

`agrune_sessions`는 특정 탭을 대상으로 하지 않으므로(tabId 없음) attach 대상이 없다. 이 도구는 예외로, 나머지 탭 대상 도구(`agrune_snapshot`, `agrune_act`, `agrune_fill`, `agrune_drag`, `agrune_pointer`, `agrune_wait`, `agrune_guide`, `agrune_read`, `agrune_config`)는 모두 eager attach.

### 영향

- `ensureAttached()`는 이미 idempotent (`attachedTabs.has(tabId)` 체크). 성능 영향 없음.
- `ensureAttached()`는 async. `command_request` 핸들러에서 fire-and-forget으로 호출 (attach 완료를 기다리지 않고 명령 전달). 읽기 전용 명령은 CDP 없이도 실행되므로 attach 지연이 명령 실행을 막지 않음.
- auto-detach(2분 idle)는 그대로 유지. 읽기 전용 호출도 idle timer를 리셋하므로 작업 중 detach 방지.
- `cdpHandler`의 `ensureAttached`를 외부에서 호출할 수 있도록 export 필요. 현재는 `handleRequest()` 내부에서만 사용.

### 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/extension/src/background/cdp-handler.ts` | `ensureAttached(tabId)` 외부 export |
| `packages/extension/src/background/message-router.ts` | `command_request` 핸들러에서 `ensureAttached()` 호출 |

---

## 2. 휠 액션 최적화

### 문제

현재 부드러운 줌을 하려면 AI가 `agrune_pointer`에 개별 wheel 액션을 수동으로 여러 개 나열해야 함:

```json
{
  "actions": [
    { "type": "wheel", "x": 500, "y": 300, "deltaY": -120, "ctrlKey": true, "delayMs": 100 },
    { "type": "wheel", "x": 500, "y": 300, "deltaY": -120, "ctrlKey": true, "delayMs": 100 },
    { "type": "wheel", "x": 500, "y": 300, "deltaY": -120, "ctrlKey": true, "delayMs": 100 }
  ]
}
```

AI가 적절한 `deltaY`, 반복 횟수, `delayMs`를 매번 결정해야 하며, 토큰 낭비가 큼.

### 목표

한 번의 wheel 액션으로 부드러운 다단계 줌을 표현할 수 있게 한다.

### 설계

기존 wheel 액션에 `steps`와 `durationMs` 옵션을 추가.

```typescript
// 기존 (유지)
{ type: 'wheel', x: 500, y: 300, deltaY: -120, ctrlKey: true }

// 신규: 부드러운 다단계 줌
{ type: 'wheel', x: 500, y: 300, deltaY: -360, ctrlKey: true, steps: 3, durationMs: 300 }
```

**동작:**
- `steps`가 지정되면 `deltaY`를 `steps`로 나눠 균등 분배
- 각 스텝 사이에 `durationMs / steps` 간격으로 딜레이 삽입
- `steps` 미지정 시 기존 동작 (단일 이벤트)

위 예시는 다음과 동일:
1. wheel(deltaY: -120) → 100ms 대기
2. wheel(deltaY: -120) → 100ms 대기
3. wheel(deltaY: -120)

### MCP 도구 스키마 변경

```typescript
z.object({
  type: z.literal('wheel'),
  x: z.number(),
  y: z.number(),
  deltaY: z.number(),
  ctrlKey: z.boolean().optional(),
  delayMs: z.number().optional(),         // 기존 유지
  steps: z.number().int().min(1).optional(),  // 신규
  durationMs: z.number().optional(),          // 신규
})
```

`delayMs`와 `steps`/`durationMs`가 동시에 지정되면 `steps`/`durationMs`가 우선. 다단계 완료 후 `delayMs`가 추가로 적용됨.

### 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/mcp-server/src/mcp-tools.ts` | wheel 액션에 `steps`, `durationMs` 필드 추가 |
| `packages/core/src/index.ts` | `PointerWheelAction` 타입에 필드 추가 |
| `packages/build-core/src/runtime/command-handlers.ts` | `handlePointer()`에서 steps 분배 로직 |

---

## 테스트 계획

### 디버거 툴바
- `agrune_snapshot` 단독 호출 시 디버거 툴바 표시 확인
- `agrune_sessions` 호출 시에도 동일
- 2분 idle 후 자동 해제 확인 (기존 동작 유지)
- 해제 후 다음 호출 시 재연결 확인

### 휠 최적화
- 단일 wheel (steps 미지정): 기존 동작 유지
- `steps: 5, durationMs: 500`: 5회 분할, 100ms 간격 확인
- `deltaY` 양수/음수 모두 정확히 분배되는지
- `steps: 1`: 단일 이벤트와 동일 동작
- `delayMs` + `steps` 동시 지정: steps 실행 후 delayMs 추가 대기
