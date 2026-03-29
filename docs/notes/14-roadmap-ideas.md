# agrune Roadmap

## Phase 1: 핵심 강화 (현재 기반 확장)

바로 착수 가능. 기존 아키텍처 위에 도구/기능 추가.

### 1-0. 캔버스 좌표 정밀화 [긴급]

현재 캔버스(ReactFlow 등) 노드 조작 시 AI가 정밀 배치를 못 하는 문제가 확인됨.

**현재 문제 (AI 피드백 기반):**
- viewport 좌표와 canvas 좌표의 관계가 불명확
- 드래그 시 "카드의 어느 점을 잡아서 옮기는지" 정보 없음
- pan/zoom 상태에서 좌표 계산이 부정확
- 스냅 그리드 존재 여부를 AI가 모름
- 스냅샷에 모든 노드가 일관되게 포함되지 않는 경우 있음
- 드래그 후 최종 위치가 결과로 반환되지 않음
- 결과: "겹침 해소" 같은 거친 작업은 되지만 "정렬" 같은 정밀 작업은 불안정

**필요한 개선:**
- 노드의 실제 캔버스 좌표를 스냅샷에 포함
- viewport ↔ canvas 좌표 변환 정보 명확화 (현재 `viewportTransform` 있지만 부족)
- 현재 pan/zoom 값 스냅샷에 포함
- 드래그 결과에 최종 위치 반환
- 스냅샷에 항상 모든 노드/엣지 일관 포함
- `agrune_move(targetId, x, y, anchor?)` — 드래그 없이 직접 배치하는 API 검토
- 스냅 그리드 정보 노출 (있다면)

### 1-1. 비전 도구 `agrune_capture` [높음]

- `agrune_capture(selector?, region?)` — 페이지 전체 또는 특정 영역 스크린샷 캡처
- 범용 활용:
  - 어노테이션 빠진 요소를 시각적으로 발견 → AI가 보고 자동 보완
  - QA 중 버그 발생 시 스크린샷으로 증거 기록 (리포트 첨부)
  - 유저가 "이 화면 이상해" 하면 스크린샷 찍어서 AI가 문제 진단
  - 캔버스 기반 UI 상태 파악 (차트, 에디터 등)
- 다른 기능들의 기반이 됨 (QA 리포트, 외부 사이트 분석 등)

### 1-2. 크롬 탭 포커스 `agrune_focus` [높음]

- `agrune_focus(tabId)` — 백그라운드 탭을 앞으로 가져오기 (`chrome.tabs.update(tabId, {active: true})`)
- 현재는 `tabId`로 특정 탭에 명령을 보낼 수 있지만, 실제 포커스 전환은 안 됨
- OAuth 팝업, 새 탭 링크, 멀티탭 플로우에서 필요

### 1-3. 시스템 인터랙션 (CDP 기반) [높음]

- 파일 업로드: `agrune_upload(targetId, filePath)` — CDP `DOM.setFileInputFiles`로 다이얼로그 없이 주입
- 파일 다운로드: `agrune_download(targetId, savePath)` — CDP `Browser.setDownloadBehavior`로 자동 수락
- alert/confirm/prompt: CDP `Page.handleJavaScriptDialog`로 자동 감지 + 응답
- 권한 팝업 (카메라 등): CDP `Browser.grantPermissions`로 자동 허용
- 유저 프로젝트에 설치할 것 없음 — 전부 agrune MCP 서버 + 확장에서 처리

### 1-4. 드로잉 도구 `agrune_draw` [보통]

- `agrune_draw({ path | points | shape })` — 고수준 드로잉. AI는 의도만 전달, agrune이 좌표 보간 + pointer 이벤트 변환
  - SVG path: `path: "M 100 100 C 150 50, 200 50, 250 100"`
  - 포인트 + 스무딩: `points: [...], smooth: true`
  - 기본 도형: `shape: "circle", cx, cy, r`
- 캔버스 기반 퍼즐/턴제 게임 QA 테스트에도 활용 가능 (실시간 게임은 범위 밖)

### 1-5. 빌드 린터 [보통]

- 빌드 시 어노테이션 누락 검사 (action 있는데 name/desc 없으면 에러)
- demo에 Vite 플러그인 프로토타입 있음 (`demo/vite.config.ts`)
- npm 패키지로 빼는 대신, annotate 스킬이 프로젝트 빌드 도구에 맞춰 린터를 자동 삽입
- 린터 에러 발생 시 AI가 자동으로 어노테이션 수정 → 다시 빌드 (자동 수정 루프)

---

## Phase 2: QA 자동화

Phase 1의 비전 도구 + 시스템 인터랙션이 선행되어야 함.

### 2-1. 액션 녹화 시스템 [높음]

- 유저가 브라우저에서 실제 행동 → agrune이 액션 시퀀스를 기록 (click → fill → click → wait...)
- AI가 녹화된 시퀀스를 정리해서 재사용 가능한 플로우로 저장
- QA 활용: 플로우를 자동 반복 실행하며 깨지는 곳 탐지
- 유저 가이드 활용: 녹화된 플로우를 커서 애니메이션으로 시연 → 튜토리얼

### 2-2. 테스트 환경 변수 [높음]

- `.agrune/test-env.json`에 테스트 시 필요한 입력값 사전 정의 (로그인 정보, 테스트 데이터 등)
- .gitignore 대상
- AI가 테스트 실행 시 자동으로 참조 (폼 채울 때 여기서 값 가져옴)
- 환경별 분리 가능 (dev, staging, prod)

### 2-3. QA 스킬 [높음]

- `/agrune:qa-explore` — AI가 앱을 점진적으로 탐색하며 시나리오 그래프 생성
- `/agrune:qa-run` — 생성된 시나리오 자동 실행 + 결과 리포트
- 시나리오 그래프는 `.agrune/sitemap.json`에 저장, 탐색할 때마다 병합/업데이트
- 점진적 크롤링: 한 번에 완성하지 않고 실행할수록 지도가 커짐
- 상태 의존성(로그인, 권한, 데이터 유무)은 프로젝트 컨텍스트 + 반복 탐색으로 커버
- Playwright 테스트 코드 작성/관리 비용 제거

### 2-4. CI/CD 통합 [보통]

- Chrome `--headless=new` 모드에서 확장 지원됨 → CI에서 agrune 동작 가능
- GitHub Actions에서 headless Chrome + agrune 확장 + AI 에이전트로 자동 테스트
- 개발 서버에 상시 띄워두고 배포 트리거 시 자동 실행도 가능

---

## Phase 3: 외부 사이트 확장

agrune을 개발자 도구에서 모든 유저의 브라우저 자동화 도구로 확장.

### 3-1. 외부 사이트 자동 어노테이션 [높음]

- agrune 미적용 사이트 방문 시 확장이 DOM 분석 → AI가 셀렉터 기반 어노테이션 맵 자동 생성
- DOM 주입 없이 확장 내부에서 가상 매핑 유지 (사이트 코드와 충돌 없음)
- 자사 플랫폼: `data-agrune-*` 속성 (정확도 최고)
- 외부 사이트: 셀렉터 매핑 (호환성 최고)
- SNS/게시판은 패턴 매핑으로 처리 (반복 구조의 셀렉터 + `nameFrom`으로 컨텍스트 추출)

### 3-2. 공유 DB [높음]

- 생성된 어노테이션 맵을 중앙 DB에 저장 → 모든 agrune 확장 유저가 공유
- 누군가 YouTube에서 한 번 생성하면, 다른 유저는 바로 사용 가능
- 사이트 업데이트 시 AI가 재분석 → DB 업데이트 → 전체 유저에게 반영
- agrune 간접 체험 + 바이럴 효과

### 3-3. 전체 탭 세션 확장 [3-1과 함께]

- `agrune_sessions`가 어노테이션 있는 탭만이 아닌 모든 탭을 반환하도록 확장
- `annotated: boolean` 플래그로 어노테이션 유무 구분

---

## Phase 4: 생태계 연동 (장기)

외부 표준/프로토콜과의 호환.

### 4-1. WebMCP 호환 [낮음]

- agrune 확장이 어노테이션 스캔 시 `navigator.modelContext.registerTool()`도 호출
- 유저 프로젝트 코드 변경 없음, 확장 업데이트만으로 호환 추가
- WebMCP 표준 보급 시점에 맞춰 진행
