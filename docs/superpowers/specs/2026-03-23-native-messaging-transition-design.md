# webcli-dom: WebSocket → Chrome Native Messaging 전환 설계

## 배경

현재 webcli-dom은 Browser SDK → WebSocket → Companion Server → REST API → CLI/Agent 구조로 동작한다.
이 구조는 Companion 서버를 항상 띄워야 하고, 패키지가 5개로 분산되어 있으며, 외부 AI Agent(Claude Code, Codex, Gemini CLI)와 직접 연결이 불가능하다.

Chrome만 지원한다는 전제 하에, Chrome Extension + Native Messaging으로 전환하여 중간 서버를 제거하고 AI Agent가 브라우저를 직접 제어할 수 있도록 한다.

## 목표

1. **사용 편의성**: Companion 서버 없이 Extension + Agent만으로 즉시 동작
2. **아키텍처 단순화**: 패키지 5개 → 4개, 레이어 축소
3. **외부 AI Agent 연동**: MCP 프로토콜로 Claude Code, Codex, Gemini CLI에서 바로 브라우저 제어

## 아키텍처

```
[페이지 main world]
  런타임 (스냅샷, 클릭, 입력, 드래그, 포인터 애니메이션)
      ↕ window.postMessage
[Extension content script]
  DOM 스캔 (data-webcli-*) + 런타임 주입 + 통신 브릿지 + UI 옵션
      ↕ chrome.runtime
[Extension service worker]
      ↕ Native Messaging (stdio)
[Native Host = MCP 서버]
  세션 관리, 명령 큐잉, 스냅샷 캐시
      ↕ MCP 프로토콜 (stdio)
[AI Agent (Claude Code / Codex / Gemini CLI)]
```

## 패키지 구조 변경

| 현재 | 전환 후 | 비고 |
|---|---|---|
| `core` | `core` | 유지 — 타입 공유 |
| `build-core` | **제거** | Extension content script가 DOM 스캔 + 런타임 주입 대체 |
| `browser-client` | **제거** | Extension content script가 통신 브릿지 대체 |
| `companion` | **optional** | 디버깅 모드에서만 사용, 평소에는 실행 안 함 |
| `cli` | `cli` | MCP 서버의 thin wrapper |
| (없음) | **`extension`** | Chrome Extension (신규) |
| (없음) | **`mcp-server`** | Native Host + MCP 서버 (신규) |

최종: `core`, `extension`, `mcp-server`, `cli` + optional `companion`

## 컴포넌트 상세

### Extension

Chrome Extension (Manifest V3).

**content script**:
- 페이지 로드 시 `data-webcli-*` 속성이 있는 DOM 요소를 스캔
- 런타임 스크립트를 main world에 주입 (`chrome.scripting.executeScript` with `world: 'MAIN'`)
- 주입된 런타임과 `window.postMessage`로 통신 (스냅샷 수신, 명령 전달)
- content script는 페이지가 살아있는 한 유지됨 (MV3 service worker 수명 문제 회피)

**service worker (background)**:
- content script ↔ Native Messaging 중계
- `chrome.runtime.connectNative()` 로 Native Host 연결
- 탭 관리 (탭 열림/닫힘/전환 이벤트)
- on-demand 활성화 (메시지 수신 시 wake)

**popup/options page**:
- UI 옵션 설정: 포인터 애니메이션 on/off, aurora glow on/off, 테마(dark/light), 클릭 딜레이
- `chrome.storage.sync`에 설정 저장, content script에 실시간 반영

**승인 플로우**: 없음. Extension 설치 자체가 사용자 동의. (Claude in Chrome과 동일)

**런타임 주입 방식**:
- 현재 `build-core`의 `page-agent-runtime.ts` 로직을 Extension 번들에 포함
- content script가 `data-webcli-*` 속성 감지 시 main world에 주입
- 주입된 런타임이 `window.webcliDom` 으로 노출
- 런타임은 기존과 동일한 역할: 스냅샷 생성, act/fill/drag/wait/guide 명령 실행

**DOM 스캔 (build plugin 대체)**:
- content script가 `MutationObserver`로 DOM 변경 감지
- `data-webcli-action`, `data-webcli-name`, `data-webcli-group` 등 어노테이션 파싱
- manifest를 동적으로 생성하여 런타임에 전달
- build 타임 검증(어노테이션 오류 감지)은 별도 lint 플러그인이나 devtools 패널로 분리 (향후)

### MCP 서버 (Native Host)

Node.js 프로세스. Extension의 Native Messaging Host이자 AI Agent의 MCP 서버.

**Native Messaging Host 설정**:
- 설치 시 OS별 경로에 manifest 파일 자동 생성
  - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webcli.dom.json`
  - Linux: `~/.config/google-chrome/NativeMessagingHosts/com.webcli.dom.json`
- `allowed_origins`에 Extension ID 등록
- `path`에 MCP 서버 바이너리 경로

**세션 관리**:
- 탭 단위 세션 (탭 열림 → 세션 생성, 탭 닫힘 → 세션 제거)
- 스냅샷 캐시 (최신 스냅샷 보관, Agent 요청 시 즉시 반환)
- 명령 큐잉 (Agent → 큐 → Extension → 런타임 → 결과 반환)

**MCP 도구 노출**:
- `webcli_snapshot`: 현재 페이지 스냅샷 반환 (타겟 목록, 상태, 그룹)
- `webcli_act`: 타겟 클릭 (`{ targetId }`)
- `webcli_fill`: 타겟에 값 입력 (`{ targetId, value }`)
- `webcli_drag`: 드래그 앤 드롭 (`{ sourceTargetId, destinationTargetId, placement }`)
- `webcli_wait`: 타겟 상태 대기 (`{ targetId, state, timeoutMs }`)
- `webcli_guide`: 타겟 시각적 가이드 (`{ targetId }`)
- `webcli_sessions`: 활성 세션(탭) 목록
- `webcli_config`: 런타임 설정 변경 (포인터 애니메이션 등)

**통신 프로토콜 (Extension ↔ Native Host)**:
- Chrome Native Messaging: 4바이트 길이 프리픽스 + JSON
- 메시지 타입:
  - `snapshot_update`: Extension → Host (스냅샷 전송)
  - `command_request`: Host → Extension (명령 전달)
  - `command_result`: Extension → Host (명령 결과)
  - `session_open` / `session_close`: 탭 열림/닫힘
  - `config_update`: Host → Extension (설정 변경)

### CLI

MCP 서버에 직접 연결하는 thin client.

- `webcli status`: 연결 상태 확인
- `webcli sessions`: 활성 탭 목록
- `webcli snapshot`: 현재 스냅샷
- `webcli act --target <id>`: 클릭
- `webcli fill --target <id> --value <v>`: 입력
- `webcli drag --source <id> --dest <id>`: 드래그
- `webcli wait --target <id> --state <s>`: 대기

내부적으로 MCP 서버와 stdio 또는 HTTP로 통신.

### Companion (optional)

기존 TUI + 로깅 기능 유지. 디버깅 시에만 사용.

- MCP 서버의 트래픽을 미러링하여 로깅
- TUI로 실시간 스냅샷/명령 모니터링
- 평소에는 실행하지 않음

연결 방식: MCP 서버에 디버깅 모드 플래그 (`--debug`) 전달 시 Companion에도 이벤트 전송.

## MV3 Service Worker 수명 대응

Manifest V3의 service worker는 비활성 시 30초~5분 후 종료된다. 대응 전략:

1. **content script가 주 통신 유지**: content script는 페이지가 살아있는 한 죽지 않음. 스냅샷 수집, 명령 실행 모두 content script에서 처리.
2. **service worker는 메시지 전달 시에만 활성화**: content script → `chrome.runtime.sendMessage()` → service worker wake → Native Messaging 전달.
3. **Native Messaging 연결 on-demand**: 매 메시지마다 `chrome.runtime.sendNativeMessage()` 사용 (persistent connection 대신). 또는 `chrome.runtime.connectNative()`로 포트 열고 keep-alive 패턴 적용.
4. **재연결 로직**: 연결 끊김 감지 시 자동 재연결. Claude in Chrome 선례를 따름.

## 메시지 크기

- 현재 스냅샷: 10~50KB (타겟 50~200개)
- Native Messaging 제한: 1MB
- 문제없음. 대형 페이지에서도 어노테이션된 타겟만 추적하므로 1MB 초과 가능성 극히 낮음.

## 설치 흐름

1. Chrome Web Store에서 Extension 설치 (한번)
2. `npm install -g @webcli-dom/mcp-server` (또는 npx)
3. MCP 서버 첫 실행 시 Native Messaging Host 설정 파일 자동 생성
4. AI Agent 설정에서 MCP 서버 등록:
   ```json
   // Claude Code: .claude/settings.json
   { "mcpServers": { "webcli": { "command": "webcli-mcp" } } }
   ```
5. 웹앱에 `data-webcli-*` 어노테이션만 있으면 즉시 동작

## 마이그레이션 전략

### Phase 1: Extension + MCP 서버 기본 구조
- Extension 프로젝트 생성 (content script, service worker, popup)
- 런타임 main world 주입 구현
- MCP 서버 프로젝트 생성 (Native Host + MCP 도구)
- Native Messaging 통신 구현
- `webcli_snapshot`, `webcli_act` 기본 동작 확인

### Phase 2: 전체 명령 + DOM 스캔
- 모든 명령 구현 (fill, drag, wait, guide)
- MutationObserver 기반 동적 DOM 스캔
- Extension popup UI 옵션 구현
- CLI thin wrapper 구현

### Phase 3: AI Agent 연동 검증
- Claude Code에서 MCP 서버 연결 후 실제 웹앱 제어 테스트
- Codex, Gemini CLI 연동 테스트
- Companion 디버깅 모드 연결

### Phase 4: 정리
- `build-core`, `browser-client` 패키지 deprecated
- 문서 업데이트
- Chrome Web Store 배포
