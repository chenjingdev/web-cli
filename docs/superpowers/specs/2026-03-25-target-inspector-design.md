# Target Inspector — DevTools Panel Design

Date: 2026-03-25

## Purpose

Chrome DevTools에 "Agrune" 패널을 추가하여, 현재 페이지에서 수집된 타깃(group/target)을 실시간으로 조회하고 진단할 수 있게 한다. 어노테이션 개발 시 의도대로 타깃이 잡히는지 확인하고, 에이전트 운영 시 타깃이 왜 조작 불가인지 즉시 파악하는 것이 목표다.

## Use Cases

1. **개발자 디버깅** — `data-agrune-*` 어노테이션을 작성하면서, 인식되는 타깃 목록/상태를 실시간 확인
2. **에이전트 운영 모니터링** — MCP로 에이전트가 조작 중일 때, 특정 타깃이 `disabled`/`hidden`/`covered`인 이유 진단

## Architecture

### UI Surface: DevTools Panel

`chrome.devtools.panels.create()`로 DevTools에 "Agrune" 탭을 등록한다. 패널 내부는 별도 HTML로 렌더링되며, 검사 대상은 `chrome.devtools.inspectedWindow.tabId`로 결정된다.

### File Structure

```
src/
  devtools/
    devtools.html   ← DevTools 진입점 (panels.create 호출)
    devtools.ts
    panel.html      ← 인스펙터 UI
    panel.ts
    panel.css       ← panel.html에서 <link>로 로드 (빌드 시 dist/로 복사)
```

manifest.json 추가:
```json
{
  "devtools_page": "src/devtools/devtools.html"
}
```

### Build Pipeline

vite.config.ts에 두 개의 엔트리 추가:

- `src/devtools/devtools.ts` → `dist/devtools.js`
- `src/devtools/panel.ts` → `dist/panel.js`

`panel.css`는 빌드 시 `dist/panel.css`로 복사한다. `devtools.html`과 `panel.html`은 `src/`에 위치하며, JS 참조는 기존 popup과 동일하게 `../../dist/devtools.js`, `../../dist/panel.js` 상대 경로를 사용한다.

### Data Flow

기존 흐름은 변경하지 않는다.

**기존** (변경 없음):
```
page runtime → content script → background → native host
```

**추가** (devtools panel 구독):
```
content script → background → devtools panel
```

### Communication Model: Port-based Subscription

DevTools panel은 `chrome.runtime.connect()`로 background에 장기 연결(Port)을 맺는다. 기존 one-shot `onMessage` 라우팅과 분리된 별도 채널이다.

**background 측 (service-worker.ts 또는 message-router.ts):**

- `chrome.runtime.onConnect.addListener()`로 port 연결 수신
- port.name이 `"devtools-inspector"`인 경우만 처리
- port에서 `subscribe_snapshot` 메시지 수신 시 구독자 맵에 등록
- port.onDisconnect 시 구독자 맵에서 제거 (panel 닫힘 처리)

**구독자 맵:** `Map<number, Set<chrome.runtime.Port>>` (tabId → panel ports)

**스냅샷 인터셉션 포인트:** `message-router.ts`의 `handleRuntimeMessage` 내 `case 'snapshot':` 분기에서, native host로 포워딩하는 기존 로직 직후에, 해당 tabId에 대한 구독자가 있으면 `devtools_snapshot` 메시지를 port로 전송한다.

**highlight/clear_highlight:** devtools panel이 port를 통해 전송 → background의 `port.onMessage` 콜백에서 수신 (handleRuntimeMessage가 아님) → `chrome.tabs.sendMessage(tabId, msg)`로 content script에 중계.

### Message Types (추가, 4개)

```typescript
// devtools panel → background (via port)
| { type: 'subscribe_snapshot'; tabId: number }

// background → devtools panel (via port)
| { type: 'devtools_snapshot'; tabId: number; snapshot: PageSnapshot }

// devtools panel → background (via port) → content script (via tabs.sendMessage)
| { type: 'highlight_target'; tabId: number; targetId: string; selector: string }
| { type: 'clear_highlight'; tabId: number }
```

> `devtools_snapshot`은 기존 `NativeMessage`의 `snapshot_update`와 이름 충돌을 피하기 위해 별도 이름을 사용한다.

## Panel Layout

### Toolbar (상단)

- **Pause/Resume 버튼** — 스냅샷 자동 갱신 일시정지/재개
- **스냅샷 정보** — 버전 번호, 경과 시간, 총 타깃 수
- **Reason 필터** — 드롭다운: All / ready / hidden / offscreen / covered / disabled / sensitive
- **ActionKind 필터** — 드롭다운: `ActionKind` 타입에서 동적으로 추출 (현재: click / fill / dblclick / contextmenu / hover / longpress)
- **텍스트 검색** — 타깃 이름, groupName, textContent 대상 필터

### Left Pane: Target List

- 그룹별로 묶어 표시. 각 그룹 헤더에 `groupName`, description, 타깃 수 노출
- 그룹 클릭으로 접기/펼치기
- 각 타깃 행: reason 색상 인디케이터(●), 타깃 이름, actionKind, reason 배지
- 선택된 타깃은 좌측 보더 하이라이트

**Reason 색상 매핑**:
- `ready` → 초록 (#a6e3a1)
- `covered` → 빨강 (#f38ba8)
- `hidden` → 주황 (#fab387)
- `offscreen` → 주황 (#fab387)
- `disabled` → 회색 (#6c7086)
- `sensitive` → 노랑 (#f9e2af)

### Right Pane: Detail Panel

선택한 타깃의 전체 필드를 key-value 테이블로 표시:

- targetId, groupId, groupName
- actionKind (배지)
- visible, enabled, inViewport, covered, actionableNow (boolean 색상 표시)
- reason (배지)
- sensitive (🔒 아이콘)
- selector
- textContent, valuePreview
- sourceFile, sourceLine, sourceColumn — `chrome.devtools.panels.openResource()`로 Sources 패널 이동 시도. 번들/minified 경로일 경우 브라우저가 해당 리소스를 인식하지 못할 수 있으며, 이 경우 조용히 실패한다 (fallback 없음).

하단에 "Highlight in Page" 버튼.

## Highlight Mechanism

### Flow

```
devtools panel → (port) → background → (tabs.sendMessage) → content script → DOM overlay
```

### Implementation

- content script가 대상 요소를 `selector`로 찾고 `getBoundingClientRect()`로 위치 계산
- 페이지 위에 절대 위치 `<div>` overlay 표시: 반투명 배경 + 테두리
- 요소 상단에 라벨 표시: `targetName · reason`
- 3초 후 자동 페이드아웃
- 다른 타깃 클릭 시 기존 하이라이트 교체
- `overlay: true`인 타깃(모달 등)은 z-index가 높을 수 있으므로, highlight overlay는 `z-index: 2147483647`로 최상위 배치
- `inspectedWindow.eval()` 사용하지 않음 — 메시지 패싱으로만 처리

### Content Script Handlers

content/index.ts의 `chrome.runtime.onMessage.addListener`에 두 개의 케이스 추가:

- `highlight_target` — 메시지에 포함된 selector로 요소 조회 → overlay 생성, 3초 타이머 시작
- `clear_highlight` — 현재 표시 중인 overlay 즉시 제거, 타이머 취소

## Update Behavior

- **자동 모드** (기본): 스냅샷 갱신마다 (800ms 주기) UI 자동 반영
- **Pause 모드**: 수신은 계속하되 UI 갱신 중단. 현재 상태를 고정해서 분석 가능
- 스냅샷 버전, 마지막 갱신 시각을 툴바에 표시
- 스냅샷 버전이 불연속(gap)인 경우 — pause 중 누락 등 — 별도 경고 없이 최신 버전으로 갱신

## Edge Cases

### 탭 네비게이션

inspected 탭이 새 페이지로 이동하면 content script가 재초기화되고 새 `session_open`이 발생한다. 구독은 tabId 기반이므로 유효하지만, 새 스냅샷이 올 때까지 panel은 이전 스냅샷을 표시한다. 첫 스냅샷 수신 전까지 툴바에 "Waiting for snapshot..." 표시.

### 탭 닫힘

background의 기존 `tabs.onRemoved` 리스너에서 해당 tabId의 구독자 port를 정리한다. port.onDisconnect도 동일하게 정리 트리거로 동작한다.

### DevTools panel 재열기

panel이 닫혔다가 다시 열리면 새 port 연결 + 새 subscribe_snapshot으로 구독 재개. 이전 상태는 복원하지 않는다.

## Existing Code Changes

### background/message-router.ts

- `chrome.runtime.onConnect` 리스너 추가 (port.name === `"devtools-inspector"`)
- devtools panel 구독자 맵: `Map<number, Set<chrome.runtime.Port>>` (tabId → ports)
- `handleRuntimeMessage`의 `case 'snapshot':` 분기에서 native host 포워딩 직후, 해당 tabId 구독자에게 `devtools_snapshot` 메시지 port.postMessage
- `port.onMessage` 콜백에서 `highlight_target`, `clear_highlight` 수신 시 `chrome.tabs.sendMessage(tabId, msg)`로 content script에 중계 (handleRuntimeMessage와 별개)
- port.onDisconnect 시 구독자 맵 정리
- `tabs.onRemoved` 기존 핸들러에서 구독자 맵도 정리

### content/index.ts

- `highlight_target` 메시지 핸들러 추가 — overlay 생성
- `clear_highlight` 메시지 핸들러 추가 — overlay 제거
- highlight overlay DOM 요소 생성/제거/페이드아웃 로직

### shared/messages.ts

- 위에 정의한 메시지 타입 4개 추가

### manifest.json

- `devtools_page` 필드 추가

### vite.config.ts

- `devtools.ts`, `panel.ts` 빌드 엔트리 추가
- `panel.css` dist 복사 설정
