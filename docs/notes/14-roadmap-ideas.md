# Roadmap Ideas (2026-03-29)

## QA 자동화 스킬

- `/agrune:qa-explore` — AI가 앱을 점진적으로 탐색하며 시나리오 그래프(사이트맵) 생성
- `/agrune:qa-run` — 생성된 시나리오 자동 실행 + 결과 리포트
- 시나리오 그래프는 `.agrune/sitemap.json`에 저장, 탐색할 때마다 병합/업데이트
- 점진적 크롤링 방식: 한 번에 완성하지 않고 실행할수록 지도가 커짐
- 상태 의존성(로그인, 권한, 데이터 유무)은 프로젝트 컨텍스트 + 반복 탐색으로 커버
- 최초 1회 유저가 동작한 루트를 에이전트가 정리해서 스킬로 저장 → 이후 자동화 테스트에 활용
- Playwright는 테스트 코드 작성/관리 비용이 높음. AI가 어노테이션 기반으로 자동 테스트하면 진입장벽 제거

### 액션 녹화 시스템

- 유저가 브라우저에서 실제 행동 → agrune이 액션 시퀀스를 기록 (click → fill → click → wait...)
- AI가 녹화된 시퀀스를 정리해서 재사용 가능한 플로우로 저장
- QA 활용: 플로우를 자동 반복 실행하며 깨지는 곳 탐지
- 유저 가이드 활용: 녹화된 플로우를 커서 애니메이션으로 시연 → 튜토리얼

### 테스트 환경 변수 (.agrune/test-env)

- 테스트 시 필요한 입력값을 사전에 정의 (로그인 정보, 테스트 데이터 등)
- `.agrune/test-env.json` 같은 파일로 관리, .gitignore 대상
- AI가 테스트 실행 시 자동으로 참조 (폼 채울 때 여기서 값 가져옴)
- 환경별 분리 가능 (dev, staging, prod)

### 시스템 인터랙션 (CDP 기반)

- 파일 업로드: `agrune_upload(targetId, filePath)` — CDP `DOM.setFileInputFiles`로 다이얼로그 없이 주입
- 파일 다운로드: `agrune_download(targetId, savePath)` — CDP `Browser.setDownloadBehavior`로 자동 수락
- alert/confirm/prompt: CDP `Page.handleJavaScriptDialog`로 자동 감지 + 응답
- 권한 팝업 (카메라 등): CDP `Browser.grantPermissions`로 자동 허용
- 유저 프로젝트에 설치할 것 없음 — 전부 agrune MCP 서버 + 확장에서 처리

## WebMCP 호환

- agrune 확장이 어노테이션 스캔 시 `navigator.modelContext.registerTool()`도 호출
- 유저 프로젝트 코드 변경 없음, 확장 업데이트만으로 호환 추가
- WebMCP 표준 보급 전까지는 우선순위 낮음
- 반대 방향(WebMCP 도구를 agrune MCP 서버로 브릿지)도 가능하지만 필요성 낮음

## 빌드 린터

- 빌드 시 어노테이션 누락 검사 (action 있는데 name/desc 없으면 에러)
- demo에 Vite 플러그인 프로토타입 있음 (`demo/vite.config.ts`)
- npm 패키지로 빼는 대신, annotate 스킬이 프로젝트 빌드 도구에 맞춰 린터를 자동 삽입
- 린터 에러 발생 시 AI가 자동으로 어노테이션 수정 → 다시 빌드 (자동 수정 루프)

## 캔버스 / 비전 도구

- `agrune_capture(selector, region?)` — 캔버스 또는 특정 영역 스크린샷 캡처
- `agrune_draw({ path | points | shape })` — 고수준 드로잉. AI는 의도만 전달, agrune이 좌표 보간 + pointer 이벤트 변환
  - SVG path: `path: "M 100 100 C 150 50, 200 50, 250 100"`
  - 포인트 + 스무딩: `points: [...], smooth: true`
  - 기본 도형: `shape: "circle", cx, cy, r`
- 스크린샷 + 어노테이션 스냅샷 = 자사 플랫폼 e2e에서 Playwright MCP 대체 가능
- 캔버스 기반 퍼즐/턴제 게임 QA 테스트에도 활용 가능 (실시간 게임은 범위 밖)

## CI/CD 통합

- Chrome `--headless=new` 모드에서 확장 지원됨 → CI에서 agrune 동작 가능
- GitHub Actions에서 headless Chrome + agrune 확장 + AI 에이전트로 자동 테스트
- 개발 서버에 상시 띄워두고 배포 트리거 시 자동 실행도 가능
