# CDP 마이그레이션 — 남은 작업

이전 작업: `11-cdp-migration-issues.md` (#5 CDP 와이어링, #8 합성 fallback 제거 완료)
브랜치: `feat/cdp-migration`

---

## 미해결 이슈

### #3. 스냅샷에 엣지(연결선) 정보 누락

**현상:** agrune 스냅샷에 React Flow 엣지 정보가 포함되지 않음. AI가 어떤 노드가 이미 연결되어 있는지 모르므로 중복 연결 시도, 연결선 클릭/삭제 불가.

**영향 범위:**
- `packages/build-core/src/runtime/snapshot.ts` — 스냅샷 수집 로직
- React Flow의 `.react-flow__edge` 또는 store에서 엣지 데이터 추출 필요

**해결 방향:** 스냅샷 수집 시 엣지 정보(source/target node, handle id)를 포함하거나, 각 핸들의 description에 연결 상태를 반영.

**검증:** 워크플로우 탭에서 `agrune_snapshot`으로 엣지 정보가 나오는지 확인.

---

### #6. MCP 서버 배포 프로세스 누락

**현상:** `pnpm build`만으로는 MCP 서버 변경사항이 `~/.agrune/mcp-server/`에 반영되지 않음. 수동으로 `cp -r packages/mcp-server/dist/* ~/.agrune/mcp-server/` + 백엔드 데몬 재시작이 필요.

**영향 범위:**
- 루트 `package.json` 또는 `packages/mcp-server/package.json`의 빌드 스크립트
- 또는 `packages/cli/`에 `agrune dev-sync` 같은 명령 추가

**해결 방향:**
- (A) `pnpm build` 후 자동 복사하는 postbuild 스크립트
- (B) 개발 중에는 `~/.agrune/mcp-server` 심볼릭 링크를 모노레포 dist로 연결
- (C) CLI에 `agrune dev` 명령 추가

**검증:** `pnpm build` 후 MCP 서버 변경이 즉시 Claude Code에 반영되는지 확인.

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

---

### #11. CDP 디버거 자동 해제

**현상:** 이벤트 커맨드 실행 후에도 Chrome 상단 "agrune에서 이 브라우저에 대한 디버깅을 시작함" info bar가 계속 남아있음.

**영향 범위:**
- `packages/extension/src/background/cdp-handler.ts` — idle timer + `chrome.debugger.detach()`

**해결 방향:** cdp-handler에 idle timer 추가. 마지막 CDP 요청 후 일정 시간(예: 30초) 동안 새 요청이 없으면 `chrome.debugger.detach()` 호출. 다음 요청 시 `ensureAttached()`가 자동으로 다시 연결함 (기존 lazy attach 방식).

**검증:**
1. `agrune_act` 실행 → info bar 표시
2. 30초 대기 → info bar 자동 소멸
3. 다시 `agrune_act` 실행 → info bar 재표시 → 정상 동작
