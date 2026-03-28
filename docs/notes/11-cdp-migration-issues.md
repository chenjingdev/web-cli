# CDP 마이그레이션 후 발견된 이슈

> **상태:** 전체 11건 해결 완료. CDP 마이그레이션 완료. (2026-03-28)

---

## 해결 완료

### ✅ #1. 카드 드래그 애니메이션 — CDP로 자동 해결

### ✅ #2. 칸반 카드 이동 — CDP로 자동 해결

### ✅ #3. 스냅샷에 엣지(연결선) 정보 누락

agrune 이슈 아님. 앱 측에서 엣지에 `data-agrune-*` 어노테이션을 추가하면 해결.

### ✅ #4. 캔버스 줌 — CDP로 자동 해결

### ✅ #5. CDP 실제 연결

`page-agent-runtime.ts`에서 `cdpPostMessage` 콜백을 주입하여 `createCdpClient()` → `createEventSequences()` 체인 활성화. `content/index.ts`의 cdp_request 릴레이에서 `type` 필드 누락 버그도 수정.

### ✅ #6. MCP 서버 배포 프로세스 누락 → `412fe81`

`pnpm build` postbuild 스크립트에서 `~/.agrune/mcp-server/`로 자동 복사 + 데몬 재시작.

### ✅ #7. 워크플로우 노드 드래그 — CDP로 자동 해결

### ✅ #8. 합성 이벤트 fallback 코드 제거

`synthetic-dispatch.ts` (556줄) 삭제, `SyntheticDispatchFallback` 인터페이스 및 `command-handlers.ts` 5곳의 분기 제거. `eventSequences`를 non-null 필수 의존성으로 변경.

### ✅ #9. pointer 액션 간 딜레이 지원 → `98d3668`

각 pointer 액션에 `delayMs?: number` 필드를 추가하여 단계별 딜레이 삽입 가능.

### ✅ #10. 캔버스 노드 좌표 계산 정확도 → `67a5ce9`

스냅샷에 캔버스 viewport transform(`{ scale, x, y }`)을 포함하여 AI가 뷰포트 ↔ 캔버스 좌표를 변환할 수 있게 함.

### ✅ #11. CDP 디버거 자동 해제 → `bf7306f`

2분 idle timer + MCP 활동 기반 유지. 다음 커맨드 시 lazy re-attach.
