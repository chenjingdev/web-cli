# CDP 마이그레이션 후 발견된 이슈

## 1. 카드 드래그 애니메이션 소실

**현상:** 칸반 카드 드래그 시 커서만 이동하고 카드는 순간이동함. 기존에는 카드가 커서를 따라 시각적으로 이동했음.

**원인 추정:** 현재 CDP가 실제로 연결되지 않고 `syntheticFallback`을 사용 중. fallback의 `animatePointerDragWithCursor`는 커서 애니메이션만 하고 `performPointerDragSequence`를 한 번에 실행해서 카드가 중간 이동 없이 최종 위치로 순간이동. 기존에는 드래그 중 매 프레임마다 pointermove를 보내면서 카드가 따라왔음.

**해결 방향:** CDP 연결을 실제로 활성화하거나, syntheticFallback의 드래그 애니메이션에서 매 프레임 pointermove 디스패치를 복원.

## 2. 칸반 카드 이동 안 됨

**현상:** `agrune_drag`가 `ok: true` 반환하지만 실제로 카드가 다른 컬럼으로 이동하지 않음.

**원인 추정:** 칸반 카드는 `draggable="true"` HTML5 드래그를 사용할 가능성 높음. 합성 드래그 이벤트가 실제 DOM 상태 변경을 트리거하지 못할 수 있음. CDP `Input.dispatchDragEvent`로 전환되면 해결될 가능성.

## 3. 워크플로우 핸들 연결 — 이미 연결된 것을 재연결 시도

**현상:** `agrune_drag`로 기획 출력 → 디자인 입력 연결 시, 이미 연결이 존재하는 핸들 쌍을 시도함. 기존 연결 상태를 확인하지 않음.

**원인:** agrune 스냅샷에 기존 엣지(연결선) 정보가 포함되지 않음. AI가 어떤 노드가 이미 연결되어 있는지 알 수 없어서 중복 연결을 시도함.

**해결 방향:** 스냅샷에 기존 엣지 정보를 포함하거나, 연결 상태를 description에 반영.

## 4. 캔버스 줌 위치 문제

**현상:** 줌 인/아웃 자체는 동작하나, 마우스 커서가 캔버스와 전혀 다른 위치에 있는 상태에서 줌이 됨. 커서가 캔버스 위에 위치한 상태에서 줌 조절해야 자연스러움.

**원인:** `agrune_pointer` wheel 이벤트 시 커서 애니메이션이 wheel에서는 동작하지 않음. 이벤트는 `.react-flow__pane` 셀렉터로 전달되어 기능적으로는 동작하지만, 시각적으로 커서가 캔버스를 가리키지 않음.

**해결 방향:** pointer 커맨드 실행 시 커서를 해당 좌표로 이동시키는 애니메이션 추가. 또는 CDP 연결 후 자연스럽게 해결될 수 있음.

**참고:** ~~`agrune_pointer` 도구 미노출 문제~~ → **해결됨.** MCP 서버 빌드 결과물이 `~/.agrune/mcp-server/`에 반영 안 됐던 것. 빌드 후 수동 복사 + 백엔드 데몬 재시작으로 해결.

## 6. MCP 서버 배포 프로세스 누락

**현상:** `pnpm build`만으로는 MCP 서버 변경사항이 반영되지 않음.

**원인:** MCP 서버가 `~/.agrune/mcp-server/`에 별도 설치되어 있고, Claude Code가 그 경로를 참조. 모노레포의 `packages/mcp-server/dist/`와 동기화되지 않음.

**해결 방향:** `pnpm build` 후 `~/.agrune/mcp-server/`로 자동 복사하는 스크립트 또는 CLI 명령 추가. 또는 개발 중에는 MCP 서버 참조 경로를 모노레포의 dist를 직접 가리키도록 변경.

## 5. CDP 실제 연결 미완성

**현상:** 코드 구조는 완성되었으나, `enableCdp()` 함수가 외부에서 호출되지 않아 모든 이벤트가 여전히 합성 이벤트 fallback으로 실행됨.

**원인:** Task 12b에서 `enableCdp()` 함수를 만들었으나 page-runtime.ts에서 호출하는 연결이 없음. CDP client가 생성되고 bridge를 통해 background의 chrome.debugger로 연결되는 마지막 와이어링이 빠져있음.

**해결 방향:** page-runtime.ts에서 runtime 초기화 시 `postMessage` 콜백을 전달하고, runtime이 CDP client를 생성하여 event sequences를 활성화하도록 연결. 이것이 완료되면 이슈 1, 2, 4가 함께 해결될 가능성 높음.

## 7. 워크플로우 노드 드래그 안 됨

**현상:** `agrune_drag`로 노드를 좌표로 이동 시도 시 `ok: true` 반환하지만 노드가 실제로 안 움직임.

**원인:** #5와 동일. 합성 pointer 이벤트(`isTrusted: false`)를 React Flow가 무시. CDP `isTrusted: true` 이벤트가 필요.

## 우선순위

1. **CDP 실제 연결 (#5)** — 이게 해결되면 #1, #2, #4, #7이 동시에 해결될 가능성
2. **줌 시 커서 위치 (#4)** — 시각적 UX
3. **엣지 정보 스냅샷 (#3)** — AI가 기존 연결 상태를 알 수 있도록
