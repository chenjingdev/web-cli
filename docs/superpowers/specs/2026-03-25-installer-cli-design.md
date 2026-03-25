# Installer CLI Design Spec

작성일: 2026-03-25

## 개요

`@agrune/cli` — npm에 배포되는 단일 패키지로, `pnpm dlx @agrune/cli <command>`로 1회성 실행.
빌드된 mcp-server 아티팩트를 패키지 내에 번들하여 `~/.agrune/`에 설치한다.
Chrome Extension은 Chrome Web Store를 통해 배포한다.

## 목표 UX

```bash
pnpm dlx @agrune/cli setup
```

레포 클론 없이, 한 번의 명령으로 설치 완료.

## 패키지 구조

```
packages/cli/
├── package.json          # @agrune/cli, bin: { "agrune": "./dist/bin/agrune.js" }
├── tsup.config.ts
├── bin/
│   └── agrune.ts         # 엔트리포인트, 서브커맨드 디스패치
├── src/
│   ├── commands/
│   │   ├── setup.ts      # TUI wizard → 설치 수행
│   │   ├── doctor.ts     # 진단 체크리스트 실행
│   │   ├── repair.ts     # doctor 실패 항목 자동 복구
│   │   ├── update.ts     # 버전 비교 → 변경분 업데이트
│   │   └── uninstall.ts  # 역순 제거
│   ├── checks/           # doctor/repair 공유 진단 로직
│   │   ├── index.ts
│   │   ├── native-host.ts
│   │   ├── mcp-config.ts
│   │   └── runtime-files.ts
│   └── utils/
│       ├── paths.ts      # ~/.agrune, 네이티브 호스트 경로 등
│       ├── platform.ts   # OS 감지
│       └── version.ts    # version.json 읽기/쓰기
└── assets/               # 빌드 시 번들되는 pre-built 아티팩트
    └── mcp-server/       # 빌드된 mcp-server 파일들
```

## 서브커맨드

### `setup`

TUI wizard (@clack/prompts). 멀티셀렉트로 설치 항목 선택:

- **Chrome Extension** — CWS 페이지를 브라우저에서 열어줌
- **Claude MCP** — `~/.claude/settings.json`에 `mcpServers.agrune` 등록
- **Codex MCP** — Codex MCP 설정 등록

공통 동작:
- `~/.agrune/mcp-server/` 에 빌드된 런타임 파일 복사
- 네이티브 호스트 매니페스트 등록
- `~/.agrune/version.json` 기록
- 이미 설치된 항목은 감지해서 "이미 설치됨" 표시
- `--force` 플래그로 덮어쓰기 가능

### `doctor`

설치 상태 진단 체크리스트:

- `~/.agrune/mcp-server/` 존재 여부
- 네이티브 호스트 매니페스트 유효성
- 네이티브 호스트 wrapper 실행 권한
- Claude MCP 설정 등록 여부
- Codex MCP 설정 등록 여부
- 설치 버전 vs CLI 버전 비교 (업데이트 가능 알림)

### `repair`

`doctor`와 동일한 체크리스트를 돌리되, 실패 항목을 자동 수정.
수정 전 확인 프롬프트 한 번 표시.

### `update`

`~/.agrune/version.json`의 설치 버전과 CLI 패키지 버전 비교.
다르면 런타임 파일 교체 + 네이티브 호스트 재등록.

### `uninstall`

멀티셀렉트로 제거 항목 선택:

- 런타임 파일 (`~/.agrune/`)
- 네이티브 호스트 매니페스트
- Claude MCP 설정
- Codex MCP 설정
- Chrome Extension (수동 제거 안내만)

설정 파일 수정 전 `.bak` 백업 생성.

## 데이터 모델

### `~/.agrune/version.json`

```json
{
  "version": "0.1.0",
  "installedAt": "2026-03-25T12:00:00Z",
  "updatedAt": "2026-03-25T12:00:00Z",
  "components": {
    "mcp-server": true,
    "native-host": true,
    "claude-mcp": true,
    "codex-mcp": false,
    "chrome-extension": true
  }
}
```

### doctor/repair 공유 체크 인터페이스

```typescript
interface Check {
  name: string;
  check: () => Promise<CheckResult>;
  fix: () => Promise<void>;
}
```

`doctor`는 `check()`만 실행, `repair`는 `check()` → 실패 시 `fix()` 실행.

## 빌드 및 배포

### 빌드 순서

1. `pnpm -r build` — core → build-core → extension → mcp-server 순서로 빌드
2. mcp-server `dist/` → `cli/assets/mcp-server/`에 복사
3. cli 빌드 (tsup, assets 포함)

### package.json

```json
{
  "name": "@agrune/cli",
  "version": "0.1.0",
  "bin": { "agrune": "./dist/bin/agrune.js" },
  "files": ["dist/", "assets/"],
  "dependencies": {
    "@clack/prompts": "^0.9"
  }
}
```

- `files` 필드로 `dist/` + `assets/`만 npm에 올라감
- 런타임 의존성은 `@clack/prompts`뿐, 나머지는 tsup으로 번들

### 기존 코드 이전

`packages/mcp-server/src/install.ts`의 핵심 로직(네이티브 호스트 등록, 경로 탐지 등)을 `packages/cli/src/`로 이전.
mcp-server에서 `install` 서브커맨드 제거.

## 플랫폼 지원

| 플랫폼 | 네이티브 호스트 경로 | 지원 |
|--------|---------------------|------|
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | ✔ |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/` | ✔ |
| Windows | 레지스트리 기반 | 1차 미지원 |

## 에러 처리

- 설정 파일 수정 전 항상 `.bak` 백업
- JSON 파싱 실패 시 파일을 건드리지 않고 수동 설정 방법 안내
- 권한 문제 시 `chmod` 시도, 실패하면 수동 명령어 안내
- 비대화형 환경 (`!process.stdout.isTTY`) 감지 시 에러 메시지 출력
