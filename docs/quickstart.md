# agrune Quick Start

## 1. 사전 요구사항

- **Node.js** 18 이상
- **Chrome** 브라우저
- **Claude Code** 또는 **Claude Desktop**

## 2. 설치

```bash
npx @agrune/cli setup
```

setup이 자동으로 처리하는 것:
- MCP 서버 런타임 설치 (`~/.agrune/`)
- 네이티브 메시징 호스트 등록
- Claude MCP 설정 (`claude_desktop_config.json` 또는 `settings.json`)

## 3. Chrome 확장 프로그램 설치

### Chrome Web Store (권장)

설치 링크: `https://chromewebstore.google.com/detail/gchelkphnedibjihiomlbpjhjlajplke`

### 로컬 개발 모드

1. `chrome://extensions` 열기
2. 우상단 "개발자 모드" 켜기
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. `packages/extension` 폴더 선택

## 4. 연결 확인

```bash
npx @agrune/cli doctor
```

모든 항목이 통과되면 설치 완료. 실패 항목이 있으면:

```bash
npx @agrune/cli repair
```

## 5. 첫 사용

Claude에서 agrune MCP 도구를 사용해보세요.

### 페이지 읽기

Chrome에서 아무 웹페이지를 열고 Claude에게:

> "현재 열린 페이지를 읽어줘"

Claude가 `agrune_read` 도구로 페이지 DOM을 마크다운으로 변환해서 보여줍니다.

### 페이지 조작

> "검색창에 'hello'를 입력해줘"

Claude가 `agrune_act` 도구로 브라우저를 직접 조작합니다.

### 사용 가능한 MCP 도구

| 도구 | 설명 |
|---|---|
| `agrune_read` | 현재 페이지의 DOM을 마크다운으로 읽기 |
| `agrune_act` | 클릭, 입력, 스크롤 등 브라우저 액션 수행 |

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| doctor에서 native host 실패 | `npx @agrune/cli repair` 실행 |
| 확장 프로그램 연결 안 됨 | Chrome에서 확장 프로그램 새로고침 후 재시도 |
| MCP 서버 연결 안 됨 | Claude 앱 재시작 |
