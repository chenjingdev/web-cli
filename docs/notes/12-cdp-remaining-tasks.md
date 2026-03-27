# CDP 마이그레이션 — 남은 작업

이전 작업: `11-cdp-migration-issues.md` (#5 CDP 와이어링, #8 합성 fallback 제거 완료)
브랜치: `feat/cdp-migration`

---

## 해결 완료

- ~~#3. 스냅샷에 엣지 정보 누락~~ → agrune 이슈 아님. 앱 측에서 엣지에 `data-agrune-*` 어노테이션 추가하면 해결.
- ~~#6. MCP 서버 배포 프로세스 누락~~ → `412fe81` postbuild 자동 복사 + 데몬 재시작
- ~~#11. CDP 디버거 자동 해제~~ → `bf7306f` 2분 idle timer + MCP 활동 기반 유지

---

## 개선사항

### #9. pointer 액션 간 딜레이 지원

**현상:** `agrune_pointer`로 wheel 줌 등을 부드럽게 하려면 동일한 액션을 수동으로 여러 번 나열해야 함. 딜레이 없이 한꺼번에 실행되어 단계적 애니메이션이 안 됨.

**영향 범위:**
- `packages/build-core/src/runtime/command-handlers.ts` — `handlePointer()`
- `packages/core/src/` — pointer 액션 타입 정의

**해결 방향:**
- (A) 각 pointer 액션에 `delayMs?: number` 필드 추가. 핸들러에서 `await sleep(delayMs)` 삽입.
- (B) `agrune_pointer`에 `smooth: true` + `steps: number` + `durationMs: number` 옵션 추가. 시작/끝 좌표만 주면 중간 스텝을 보간하고 프레임 간 딜레이 자동 삽입.

**검증:** `agrune_pointer`로 줌 인/아웃 시 시각적으로 단계적으로 확대/축소되는지 확인.

---

### #10. 캔버스 노드 좌표 계산 정확도

**현상:** `agrune_drag`로 React Flow 노드를 정렬할 때 뷰포트 좌표와 캔버스 내부 좌표가 1:1 매핑되지 않음. 줌/팬 상태에 따라 실제 배치가 의도와 다름.

**원인:** React Flow는 내부 transform(scale, translateX, translateY)을 적용. `agrune_drag`의 `destinationCoords`는 뷰포트 좌표이지만, CDP `Input.dispatchMouseEvent`도 뷰포트 좌표를 사용하므로 드래그 자체는 정확함. 문제는 AI가 "이 노드를 x=500으로 이동"할 때 캔버스 줌/팬 상태를 모르므로 예측이 부정확한 것.

**영향 범위:**
- `packages/build-core/src/runtime/snapshot.ts` — 스냅샷에 캔버스 transform 정보 포함
- 또는 MCP 도구 레벨에서 캔버스 좌표계 변환

**해결 방향:** 스냅샷에 캔버스 viewport transform(`{ scale, x, y }`)을 포함하여 AI가 뷰포트 ↔ 캔버스 좌표를 변환할 수 있게 함.

**검증:** 줌/팬 상태에서 노드를 정확한 위치로 드래그할 수 있는지 확인.

