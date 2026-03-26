# 캔버스 포인터 지원 & CDP 전환 검토

## 발단

캔버스 기반 노드 에디터(React Flow 등)에서 다음이 안 됐다:
- 노드를 임의 좌표로 드래그 이동 (목적지가 어노테이션 타겟이 아님)
- 겹친 노드 감지 및 재배치
- 캔버스 팬/줌
- 엣지(연결선) 클릭으로 삭제

기존 `agrune_drag`는 타겟→타겟만 가능했고, 좌표 기반 조작이 없었다.

## 시도한 것

### 1. `agrune_drag` + `destinationCoords` 확장 (v0.4.0)

`agrune_drag`에 `destinationCoords: { x, y }` 옵션을 추가해서 타겟을 임의 좌표로 드래그할 수 있게 했다. `destinationTargetId`와 택 1.

- MCP 도구 결과는 `ok: true` 반환
- 실제 React Flow 노드는 움직이지 않음

### 2. `agrune_pointer` 신규 커맨드 (v0.4.0)

로우레벨 포인터/wheel 시퀀스를 직접 보내는 커맨드. 캔버스 팬, 줌, 프리핸드 드로잉용.

```typescript
agrune_pointer({
  selector: ".react-flow__pane",
  actions: [
    { type: "pointerdown", x: 500, y: 300 },
    { type: "pointermove", x: 300, y: 200 },
    { type: "pointerup",   x: 300, y: 200 }
  ]
})
```

- wheel 줌은 MCP 응답 `ok: true`이나 실제 동작 미확인
- 엣지 클릭 안 됨 — `elementFromPoint`가 `.react-flow__pane` div를 반환해서 엣지 SVG에 도달 못함

### 3. 스냅샷 `rect` 필드 추가 (v0.4.0)

full 모드 스냅샷에 각 타겟의 뷰포트 바운딩 박스(`{ x, y, width, height }`)를 포함하도록 했다. 이건 잘 동작함 — AI가 노드 위치를 보고 겹침을 판단할 수 있다.

### 4. `pointerup`에 `click` 이벤트 추가 (v0.4.1)

`agrune_pointer`의 `pointerup` 액션에서 `click` MouseEvent도 함께 디스패치하도록 수정. 기존에는 pointerup+mouseup만 보냈고 click이 빠져있었다.

- 여전히 React Flow 엣지 클릭 안 됨

## 안 된 이유

전부 **합성 이벤트** 문제:

1. `new PointerEvent()` + `element.dispatchEvent()`로 만든 이벤트는 `event.isTrusted = false`
2. React Flow는 `.react-flow__pane` div가 최상위에서 모든 포인터 이벤트를 가로챔
3. `document.elementFromPoint()`가 pane을 반환해서 엣지 SVG에 이벤트 전달 불가
4. React Flow 내부 드래그 핸들러가 합성 이벤트를 제대로 처리하지 못함

핸들→핸들 연결(기존 `agrune_drag`)은 동작함 — 이건 어노테이션된 DOM 요소에 직접 이벤트를 디스패치하기 때문.

## 다음 단계: CDP(Chrome DevTools Protocol) 전환

`chrome.debugger` API의 `Input.dispatchMouseEvent`를 사용하면 `isTrusted: true` 이벤트를 보낼 수 있다. 실제 유저 클릭과 동일.

### 바뀌는 것

- Extension Background에서 `chrome.debugger.attach()` → `Input.dispatchMouseEvent` 전송
- 기존 page-agent-runtime의 합성 이벤트 디스패치 함수들(`dispatchPointerLikeEvent`, `dispatchMouseLikeEvent` 등) → CDP로 대체
- 이벤트 조합 단순화: `mousePressed` + `mouseMoved` × N + `mouseReleased`만으로 클릭/드래그/줌 전부 가능
- manifest.json에 `"debugger"` 퍼미션 추가 필요

### 유지되는 것

- 커서 애니메이션 (DOM 조작이라 CDP와 무관)
- 스냅샷 캡처/스크롤/오버레이 감지 등 읽기 전용 로직
- MCP 도구 인터페이스 (외부 API 변경 없음)

### 주의점

- `chrome.debugger` 연결 시 "디버거가 연결됨" 인포바 표시됨 (Chrome 보안 정책, 숨길 수 없음)
- 여러 탭 동시 연결은 가능하지만, 같은 탭에 DevTools와 agrune 디버거를 동시에 붙이면 충돌
