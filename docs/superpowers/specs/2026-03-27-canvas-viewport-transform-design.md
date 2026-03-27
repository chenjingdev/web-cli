# 캔버스 뷰포트 트랜스폼 스냅샷 포함 설계

## 배경

`agrune_drag`로 React Flow 등 캔버스 위 노드를 정렬할 때, AI가 캔버스의 줌/팬 상태를 모르므로 뷰포트 좌표와 캔버스 내부 좌표 간 변환이 불가능하다. 스냅샷에 캔버스 viewport transform 정보를 포함하여 AI가 정확한 좌표 계산을 할 수 있게 한다.

## 설계

### 어노테이션

기존 `data-agrune-group` 요소에 `data-agrune-canvas` 속성을 추가한다. 값은 transform이 적용된 자식 요소의 CSS 셀렉터.

```html
<div data-agrune-group="canvas"
     data-agrune-group-name="워크플로우 캔버스"
     data-agrune-canvas=".react-flow__viewport">
```

### 스냅샷 수집

1. `makeSnapshot`에서 group을 생성할 때, `data-agrune-canvas` 속성이 있는 group 요소를 감지
2. 속성 값을 셀렉터로 사용하여 해당 group 요소 내에서 자식 요소를 탐색
3. 자식 요소의 CSS computed `transform`을 파싱하여 `{ translateX, translateY, scale }` 추출
4. `PageSnapshotGroup`에 `viewportTransform` 필드로 포함

### CSS transform 파싱

`window.getComputedStyle(el).transform`은 `matrix(a, b, c, d, e, f)` 형식으로 반환된다.
- `scale = a` (uniform scale 가정)
- `translateX = e`
- `translateY = f`

transform이 없거나 `none`이면 `{ translateX: 0, translateY: 0, scale: 1 }`.

### 타입 변경

```typescript
// packages/core/src/index.ts
export interface ViewportTransform {
  translateX: number
  translateY: number
  scale: number
}

export interface PageSnapshotGroup {
  groupId: string
  groupName: string
  groupDesc?: string
  targetIds: string[]
  viewportTransform?: ViewportTransform  // 신규
}
```

### AI 좌표 변환 공식

```
canvasX = (viewportX - translateX) / scale
canvasY = (viewportY - translateY) / scale
```

### 스냅샷 출력 예시

```json
{
  "groups": [{
    "groupId": "canvas",
    "groupName": "워크플로우 캔버스",
    "viewportTransform": { "translateX": -120, "translateY": 50, "scale": 0.75 },
    "targetIds": ["node-1", "node-2"]
  }]
}
```

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/core/src/index.ts` | `ViewportTransform` 인터페이스, `PageSnapshotGroup.viewportTransform` 추가 |
| `packages/build-core/src/runtime/snapshot.ts` | `data-agrune-canvas` 감지 + CSS transform 파싱 |
| `packages/mcp-server/src/public-shapes.ts` | public group에 `viewportTransform` 노출 |

## 검증

1. `data-agrune-canvas=".react-flow__viewport"`가 있는 그룹에서 스냅샷 조회 시 `viewportTransform` 필드가 포함되는지 확인
2. 줌/팬 상태 변경 후 스냅샷 재조회 시 값이 업데이트되는지 확인
3. `data-agrune-canvas`가 없는 그룹에는 `viewportTransform`이 없는지 확인
