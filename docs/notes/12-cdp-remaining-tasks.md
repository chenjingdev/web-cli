# CDP 마이그레이션 — 남은 작업

> **상태:** 전체 해결 완료. `feat/cdp-migration` 브랜치 머지 준비 완료. (2026-03-28)

이전 작업: `11-cdp-migration-issues.md` (전체 11건 이슈 추적)

---

## 해결 완료

- ~~#3. 스냅샷에 엣지 정보 누락~~ → agrune 이슈 아님. 앱 측에서 엣지에 `data-agrune-*` 어노테이션 추가하면 해결.
- ~~#6. MCP 서버 배포 프로세스 누락~~ → `412fe81` postbuild 자동 복사 + 데몬 재시작
- ~~#9. pointer 액션 간 딜레이 지원~~ → `98d3668` 각 pointer 액션에 `delayMs?: number` 필드 추가
- ~~#10. 캔버스 노드 좌표 계산 정확도~~ → `67a5ce9` 스냅샷에 캔버스 viewport transform 포함
- ~~#11. CDP 디버거 자동 해제~~ → `bf7306f` 2분 idle timer + MCP 활동 기반 유지

