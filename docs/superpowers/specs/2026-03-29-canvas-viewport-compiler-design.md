# 캔버스 뷰포트 컴파일러 설계

작성일: 2026-03-29

## 배경

캔버스 좌표 정밀화(1-0)를 구현했지만, AI가 여전히 캔버스를 정확히 제어하지 못하는 근본 문제가 남아 있다.

**핵심 모순:** 설계 원칙은 "런타임이 좌표 변환을 전담한다"인데, 실제 구현은 offscreen일 때 AI에게 "wheel로 팬해라"를 떠넘긴다. AI는 canvas 절대좌표로 생각하면서, viewport 관리는 직접 해야 하는 혼합 좌표계 상태.

**AI 테스트에서 확인된 증상:**
- 줌 인/아웃 할 때마다 다른 좌표 컨텍스트가 주어져서 정확도 하락
- AI가 viewport 좌표로 wheel 팬을 시도하면 오차 누적
- "확대했을 때 크게, 축소했을 때 작게 움직여야 한다"는 감각이 LLM에 없음

## 목표

- AI가 viewport를 완전히 모르게 한다. Viewport는 런타임의 구현 디테일.
- offscreen 노드 조작 시 런타임이 자동으로 뷰포트를 관리한다.
- 관계 기반 상대좌표로 AI의 좌표 계산 부담을 줄인다.
- 라이브러리 무관 원칙 유지. React Flow에서 먼저 검증.

## 설계 원칙

### 1. 좌표 계층 분리

| 대상 | AI가 사용하는 좌표 | 비고 |
|------|---------------------|------|
| 일반 UI (버튼, 폼, 메뉴) | targetId (좌표 없음) | 런타임이 DOM에서 중심점 계산 |
| 캔버스 UI (노드, 엣지) | canvas 절대좌표 | 줌/팬 불변 |
| escape hatch (프리폼, 슬라이더) | agrune_pointer (viewport) | 최후 수단 |

### 2. 런타임이 카메라맨

- offscreen이면 런타임이 CDP wheel로 자동 팬 후 실행
- AI에게 "먼저 팬해라" 에러를 반환하지 않음
- AI는 팬이 일어났는지 모르고, 알 필요 없음

### 3. 스냅샷은 전부 내려준다

- covered, offscreen 노드도 canvas 절대좌표로 전부 포함
- `viewportTransform`은 AI에게 노출하지 않음 (런타임 내부용으로 격하)

### 4. 구조 데이터 우선, 스크린샷은 인식+검증용

- 존재/위치/관계 파악 → 스냅샷 (빠르고 정확)
- 시각 콘텐츠 인식 → agrune_capture (스냅샷에 타깃이 부족하면 AI가 자연스럽게 판단. 별도 어노테이션 불필요)
- 결과 검증 → agrune_capture (배치가 시각적으로 괜찮은지 확인)

### 5. 라이브러리 무관 유지

- CSS transform 파싱 기반. 라이브러리 API 직접 호출 없음.
- React Flow에서 먼저 검증. 부족하면 optional nav contract(`data-agrune-nav`) 최소 단위로 추가.

## agrune_drag 리팩토링

### 상대좌표 모드 추가

`destinationCoords` 타입을 유니온으로 확장:

```typescript
destinationCoords:
  | { x: number; y: number }                          // 기존: 절대좌표
  | { relativeTo: string; dx: number; dy: number }    // 신규: 상대좌표
```

런타임 동작:
1. `relativeTo` 타깃의 현재 canvas 좌표 조회
2. `(ref.x + dx, ref.y + dy)` 계산
3. 절대좌표와 동일한 경로로 실행

### 자동 팬 (viewport preparation)

드래그 실행 전에 런타임이 내부적으로 처리:

```
1. 소스 노드가 viewport 안인지 확인
   → 밖이면: wheel 이벤트로 자동 팬
   → 팬 후 transform 재확인, 오차 보정 반복 (최대 3회)

2. 소스 잡기 (mousedown)

3. 목적지가 현재 viewport 안인지 확인
   → 안이면: 소스를 viewport 가장자리까지 끌고 놓기
   → 자동 팬으로 목적지 영역 이동
   → 소스 다시 잡기 → 목적지까지 드래그

4. 놓기 (mouseup)

5. movedTarget 반환 (canvas 절대좌표)
```

자동 팬 구현:
- `canvasToViewport()`로 목표 위치의 viewport 좌표 계산
- 현재 viewport 중심과의 차이만큼 wheel delta 생성
- CDP wheel 이벤트 발사 → transform 재확인 → 오차 보정 (최대 3회 반복)
- 팬 시도 후 transform 변화 없으면 `CANVAS_PAN_FAILED` 에러 반환

### OFFSCREEN 에러 제거

- 기존: offscreen이면 AI에게 "Use wheel to pan/zoom first" 에러 반환
- 변경: 에러 대신 런타임이 자동 해결. 자동 팬 실패 시에만 `CANVAS_PAN_FAILED` 반환

### viewportTransform AI 노출 제거

- `PublicSnapshotGroup.viewportTransform` → AI 응답에서 제외
- wheel 후 `updatedTransform` 반환 → 제거
- 런타임 내부(`getCanvasGroupTransform()`)에서는 계속 사용

## AI 작업 흐름

### 노드 정리 (구조 작업)

```
1. agrune_snapshot(groupId: "workflow-canvas")
   → 노드 + 엣지 + canvas 절대좌표 전부 받음
   → viewportTransform 없음

2. AI가 배치 계획 수립

3. agrune_drag 연속 실행
   agrune_drag(디자인, { relativeTo: 기획, dx: 150, dy: 0 })
   agrune_drag(개발, { relativeTo: 디자인, dx: 150, dy: 0 })
   ...

4. agrune_capture()로 결과 검증 (선택)
```

### 라벨링 (시각 작업)

```
1. agrune_snapshot(groupId: "labeling-canvas")
   → 툴바 버튼만 있고 이미지 위 타깃 없음

2. agrune_capture(groupId: "labeling-canvas")
   → 이미지를 보고 작업 대상 파악

3. agrune_pointer 또는 agrune_draw로 실행

4. agrune_capture()로 결과 검증
```

### 도구 역할 정리

| 도구 | 역할 | 좌표계 |
|------|------|--------|
| agrune_snapshot | 구조 파악 | canvas 절대 |
| agrune_drag | 노드 이동 (절대/상대) | canvas 절대 |
| agrune_capture | 시각 인식 + 결과 검증 | 없음 (이미지) |
| agrune_pointer | escape hatch | viewport |
| agrune_draw | 고수준 드로잉 | viewport (targetId 기준) |

### AI가 모르는 것 (의도적 은닉)

- viewportTransform (줌 레벨, 팬 위치)
- 어떤 노드가 현재 화면에 보이는지
- 자동 팬이 일어났는지
- CDP가 어떤 viewport 좌표로 실행했는지

## 변경 파일

| 파일 | 변경 |
|------|------|
| `core/src/index.ts` | `DestinationCoords` 타입에 `relativeTo + dx/dy` 유니온 추가 |
| `build-core/src/runtime/command-handlers.ts` | drag 핸들러에 viewport preparation 단계 삽입, OFFSCREEN → 자동 팬 교체, relativeTo 해석, destinationTargetId 분기도 동일 적용 |
| `mcp-server/src/mcp-tools.ts` | agrune_drag 스키마에 relativeTo 옵션 추가, viewport 언급 제거 |
| `mcp-server/src/public-shapes.ts` | `PublicSnapshotGroup.viewportTransform` AI 노출 제거 |
| `build-core/src/runtime/snapshot.ts` | viewportTransform 내부용 유지, public 변환 시 제외 |
| guide SKILL.md | OFFSCREEN 복구 안내 제거, viewportTransform 설명 제거, relativeTo 사용법 추가, "타깃 부족하면 capture" 규칙 추가 |
| pattern-canvas.md | "AI가 viewportTransform을 보고 판단" 설명 제거 |

## 안 바꾸는 것

- `agrune_pointer` — 저수준 viewport primitive로 유지
- `agrune_draw` — 별도 설계 그대로
- `dom-utils.ts` 좌표 변환 — 런타임 내부 사용 유지
- `data-agrune-canvas`, `data-agrune-meta` 어노테이션 — 그대로
- 일반 DOM 조작 — 영향 없음

## 지금 만들지 않는 것

- `data-agrune-nav` (optional nav contract) — React Flow 검증 후 필요 시 추가
- `agrune_layout` (배치 전용 도구) — 상대좌표로 충분하면 불필요
- 캔버스 전용 zoom/pan 도구 — 런타임 내부 처리
- 상대좌표의 체인/배치 해석 — 단일 relativeTo만 지원, 그래프 해석 불필요

## 이전 설계와의 관계

- `2026-03-29-canvas-coord-precision-design.md`의 후속. center+size, coordSpace, data-agrune-meta 등은 그대로 유지.
- 해당 설계에서 "범위 밖"으로 놔둔 `agrune_move` 직접 배치 API는 이번에도 만들지 않음. 드래그가 정확하면 충분.
- `2026-03-27-canvas-viewport-transform-design.md`에서 도입한 viewportTransform은 AI 노출에서 제거하되 런타임 내부에서 계속 사용.
