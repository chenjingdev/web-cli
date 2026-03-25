# Installer CLI 계획

작성일: 2026-03-25
**상태: 완료** — spec: `docs/superpowers/specs/2026-03-25-installer-cli-design.md`, plan: `docs/superpowers/plans/2026-03-25-installer-cli.md`

## 목적

현재 저장소 내부 설치 스크립트 상태를 정리하고, 유저가 실제로 쓰게 될 installer CLI 제품 형태를 정의한다.

## 현재 상태

지금은 독립된 설치기 패키지가 있는 것이 아니라, 저장소 안에 설치 스크립트가 들어 있는 상태다.

현재 설치 흐름은 대략 다음과 같다.

1. 저장소 클론
2. `pnpm install`
3. `pnpm dlx tsx packages/mcp-server/bin/agrune-mcp.ts install`

즉 현재는 "유저용 설치기"가 아니라 "레포 내부 개발용 설치 스크립트"에 가깝다.

## 핵심 구분

`pnpm dlx`는 제품 자체를 임시 설치하는 것이 아니라, 설치 프로그램을 일회성으로 실행하는 용도다.

예를 들면:

- `pnpm dlx @agrune/cli setup`

이 명령은 installer CLI를 잠깐 실행할 뿐이고, 실제로 계속 남아 있어야 하는 런타임 파일은 별도의 안정 경로에 설치돼야 한다.

예상되는 상시 런타임 경로:

- `~/.agrune/mcp-server/bin/agrune-mcp.js`
- `~/.agrune/native-host`
- `~/.agrune/extension/`

즉 `dlx`는 installer를 실행하는 수단이고, 유저가 실제로 계속 사용하는 코드는 `~/.agrune` 같은 영구 위치에 설치되어야 한다.

## 목표 UX

유저는 저장소 구조를 몰라도 아래 정도만 알면 설치를 끝낼 수 있어야 한다.

```bash
pnpm dlx @agrune/cli setup
```

설치기 실행 후에는 TUI wizard를 제공한다.

- `Install Chrome Extension`
- `Install Claude MCP`
- `Install Codex MCP`

선택된 항목에 따라 설치기가 각 대상에 맞는 작업을 수행한다.

## 항목별 기대 동작

### Install Chrome Extension

- 확장 빌드 또는 배포 아티팩트 준비
- 안정 경로에 확장 파일 복사
- 개발 환경에서는 `chrome://extensions` 로드 안내
- 배포 환경에서는 가능하면 Chrome Web Store 설치 경로 제공

### Install Claude MCP

- Claude 설정 파일 위치 탐지
- `mcpServers.agrune` 항목 추가 또는 업데이트
- 설치 후 간단한 검증 수행

### Install Codex MCP

- Codex MCP 설정 등록
- 필요하면 `codex mcp add` 또는 config 파일 갱신
- 설치 후 간단한 검증 수행

## 설치기에서 함께 제공할 명령

- `setup`: 첫 설치 wizard
- `doctor`: 설치/연결 상태 점검
- `repair`: 깨진 설정 복구
- `update`: 설치된 런타임 갱신
- `uninstall`: 설치 제거

## 주의할 점

- `postinstall` 훅에서 인터랙티브 TUI를 띄우면 안 된다.
- CI, 비대화형 셸, 의존성 설치 흐름에서 깨질 가능성이 높다.
- 따라서 setup wizard는 명시적 명령으로 실행해야 한다.

## 정리

- 지금은 설치 스크립트는 있지만, 배포 가능한 installer CLI는 아직 없다.
- 앞으로는 레포 내부 스크립트가 아니라 독립된 installer CLI 패키지로 제공하는 것이 맞다.
- 유저 경험의 목표는 "레포 클론 없이 한 번의 setup 명령으로 설치 완료"다.
