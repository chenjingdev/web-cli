# agrune

AI 에이전트가 브라우저를 직접 제어할 수 있도록 하는 브라우저 자동화 도구입니다.

웹 페이지의 DOM 요소에 `data-agrune-*` 어노테이션을 추가하면, Chrome 확장 프로그램이 해당 요소를 자동으로 감지하고, MCP(Model Context Protocol) 서버를 통해 AI 에이전트(Claude, Codex 등)가 클릭, 입력, 드래그 등의 브라우저 액션을 수행할 수 있습니다.

## 주요 기능

- **어노테이션 기반 DOM 제어** -- 웹 페이지에 `data-agrune-action`, `data-agrune-name` 등의 속성을 추가하여 AI가 조작할 수 있는 대상을 선언적으로 정의
- **MCP 도구 9종 제공** -- 세션 조회, 페이지 스냅샷, 클릭, 입력, 드래그, 대기, 시각적 가이드, 페이지 읽기, 런타임 설정
- **포인터 애니메이션 및 Aurora 글로우** -- AI가 브라우저를 조작하는 과정을 시각적으로 확인 가능
- **모달/오버레이 인식** -- 오버레이가 활성화되면 배경 타깃을 자동으로 차단하여 안정적 동작 보장
- **스냅샷 버전 관리** -- stale 스냅샷 사용을 방지하는 `expectedVersion` 메커니즘
- **대화형 CLI 인스톨러** -- Chrome Extension, Claude MCP, Codex MCP 설정을 한 번에 처리

## 아키텍처

```
┌─────────────────┐     Native Messaging     ┌──────────────────┐     stdio      ┌────────────────┐
│  Chrome 확장     │ ◀──────────────────────▶ │  MCP Server      │ ◀────────────▶ │  AI 에이전트    │
│  (@agrune/       │                          │  (@agrune/       │                │  (Claude, Codex │
│   extension)     │                          │   mcp-server)    │                │   등)           │
└─────────────────┘                           └──────────────────┘                └────────────────┘
        │
        │ Content Script + Page Runtime
        ▼
┌─────────────────┐
│  웹 페이지       │
│  (data-agrune-* │
│   어노테이션)    │
└─────────────────┘
```

이 프로젝트는 pnpm 워크스페이스 기반 모노레포로 구성되어 있습니다.

## 패키지 구조

| 패키지 | 경로 | 설명 |
|--------|------|------|
| **@agrune/core** | `packages/core` | 공유 타입, 에러 코드, 런타임 설정 헬퍼. 모든 패키지의 공통 기반. |
| **@agrune/build-core** | `packages/build-core` | 확장 프로그램의 페이지 내 런타임 엔진. DOM 스냅샷 생성, 액션 큐 관리, 포인터 애니메이션/커서 렌더링 등 핵심 로직 포함. |
| **@agrune/extension** | `packages/extension` | Chrome 확장 프로그램 (Manifest V3). Content Script가 `data-agrune-*` 어노테이션을 감지하고, Service Worker가 Native Messaging으로 MCP 서버와 통신. DevTools 패널과 팝업 UI 포함. |
| **@agrune/mcp-server** | `packages/mcp-server` | MCP 프로토콜 서버. AI 에이전트의 도구 호출을 받아 브라우저 명령으로 변환. 세션/스냅샷 관리, 명령 큐 처리. |
| **@agrune/cli** | `packages/cli` | 대화형 설치/진단 CLI 도구. `setup`, `doctor`, `repair`, `update`, `uninstall` 명령 제공. |

## 설치

### 빠른 설치

```bash
pnpm dlx @agrune/cli
```

대화형 인스톨러가 실행되며 아래 항목 중 설치할 것을 선택합니다:

- **Chrome Extension** -- Chrome Web Store에서 확장 프로그램 설치
- **Claude MCP** -- Claude Desktop의 MCP 서버 설정에 agrune 등록
- **Codex MCP** -- Codex CLI의 MCP 서버 설정에 agrune 등록

### 설치 상태 확인

```bash
pnpm dlx @agrune/cli doctor
```

런타임 파일, 네이티브 호스트 매니페스트, Claude/Codex MCP 설정 등 모든 구성 요소의 상태를 진단합니다.

### 기타 CLI 명령

```bash
pnpm dlx @agrune/cli update      # 최신 버전으로 업데이트
pnpm dlx @agrune/cli repair      # 문제 자동 복구
pnpm dlx @agrune/cli uninstall   # 제거
```

## 사용법

### 1. 웹 페이지에 어노테이션 추가

AI가 조작할 수 있는 요소에 `data-agrune-*` 속성을 추가합니다.

```html
<!-- 클릭 가능한 버튼 -->
<button data-agrune-action="click" data-agrune-name="Login">로그인</button>

<!-- 입력 필드 -->
<input data-agrune-action="fill" data-agrune-name="Email" type="email" />

<!-- 그룹으로 묶기 -->
<div data-agrune-group="auth-form" data-agrune-group-name="인증 폼">
  <input data-agrune-action="fill" data-agrune-name="Username" />
  <input data-agrune-action="fill" data-agrune-name="Password" type="password" data-agrune-sensitive />
  <button data-agrune-action="click" data-agrune-name="Submit">제출</button>
</div>
```

#### 어노테이션 속성

| 속성 | 설명 |
|------|------|
| `data-agrune-action` | 액션 종류: `click`, `fill`, `dblclick`, `contextmenu`, `hover`, `longpress` |
| `data-agrune-name` | 요소의 이름 (AI가 식별하는 데 사용) |
| `data-agrune-desc` | 요소에 대한 추가 설명 |
| `data-agrune-key` | 고유 타깃 ID (지정하지 않으면 자동 생성) |
| `data-agrune-sensitive` | 민감 데이터 표시 (비밀번호 등) |
| `data-agrune-group` | 그룹 ID (부모 요소에 지정) |
| `data-agrune-group-name` | 그룹 이름 |
| `data-agrune-group-desc` | 그룹 설명 |

### 2. AI 에이전트에서 MCP 도구 사용

설치가 완료되면 AI 에이전트가 아래 MCP 도구를 사용하여 브라우저를 제어합니다.

| 도구 | 설명 | 필수 파라미터 |
|------|------|---------------|
| `agrune_sessions` | 활성 브라우저 탭 목록 조회 | -- |
| `agrune_snapshot` | 페이지 스냅샷 (액션 가능한 타깃 목록) 조회 | tabId (선택) |
| `agrune_act` | 요소에 인터랙션 수행 (클릭, 더블클릭, 호버 등) | `targetId` |
| `agrune_fill` | 입력 필드에 값 입력 | `targetId`, `value` |
| `agrune_drag` | 요소를 드래그하여 다른 요소 위로 이동 | `sourceTargetId`, `destinationTargetId` |
| `agrune_wait` | 요소가 특정 상태에 도달할 때까지 대기 | `targetId`, `state` |
| `agrune_guide` | 요소를 시각적으로 하이라이트 | `targetId` |
| `agrune_read` | 페이지 콘텐츠를 마크다운으로 추출 | selector (선택) |
| `agrune_config` | 포인터 애니메이션, Aurora 글로우 등 런타임 설정 변경 | -- |

## 개발 가이드

### 요구 사항

- **Node.js** 22 이상
- **pnpm** 10.23.0 이상

### 저장소 클론 및 의존성 설치

```bash
git clone https://github.com/agrune/agrune.git
cd agrune
pnpm install
```

### 빌드

```bash
# 전체 패키지 빌드
pnpm build

# CLI 패키지만 빌드 (mcp-server 번들 포함)
pnpm build:cli
```

### 타입 체크

```bash
pnpm typecheck
```

### 테스트

```bash
pnpm test
```

### 확장 프로그램 개발 모드

```bash
# 확장 프로그램 watch 빌드
cd packages/extension
pnpm dev
```

빌드 결과물은 `packages/extension/dist/`에 생성됩니다. Chrome의 `chrome://extensions`에서 "압축해제된 확장 프로그램을 로드합니다"를 선택하여 `packages/extension/` 디렉터리를 지정하면 개발 모드로 사용할 수 있습니다.

### MCP 서버 개발 모드

```bash
cd packages/mcp-server
pnpm dev
```

### 기술 스택

- **TypeScript** (ES2022, ESNext 모듈)
- **tsup** -- 패키지 번들링
- **Vite** -- 확장 프로그램 빌드
- **Vitest** -- 테스트
- **Zod** -- MCP 도구 스키마 검증
- **@modelcontextprotocol/sdk** -- MCP 서버 구현
- **@clack/prompts** -- CLI 대화형 인터페이스
- **ai-motion** -- 포인터 애니메이션

## 릴리스

`v*` 태그를 push하면 GitHub Actions 워크플로우가 자동으로 실행됩니다:

1. 모든 패키지의 버전이 태그와 일치하는지 검증
2. CLI 패키지를 빌드하고 페이로드 검증
3. `@agrune/core`, `@agrune/build-core`, `@agrune/cli`를 npm에 퍼블리시
4. Chrome 확장 프로그램을 빌드하여 Chrome Web Store에 업로드

## 개인정보 처리방침

agrune은 사용자의 개인정보를 보호합니다:

- 모든 데이터는 **로컬 기기**에서만 처리됩니다
- 확장 프로그램과 로컬 MCP 서버 사이에서만 데이터가 전송됩니다
- 외부 서버, 제3자, 클라우드 서비스로 데이터를 **전송하지 않습니다**
- 개인 식별 정보를 수집하지 않습니다

자세한 내용은 [PRIVACY.md](./PRIVACY.md)를 참고하세요.

## 라이선스

MIT
