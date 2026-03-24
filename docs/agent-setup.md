# AI Agent 연동 가이드

`rune`은 Chrome 확장 프로그램과 `rune-mcp`를 통해 AI Agent가 브라우저를 직접 제어하도록 구성된다.

## 사전 준비

1. 저장소에서 의존성 설치: `pnpm install`
2. 설치 실행: `pnpm dlx tsx packages/mcp-server/bin/rune-mcp.ts install`
3. `chrome://extensions`에서 `~/.runeai/extension/`을 로드

## Agent 등록

Claude Code:

```json
{
  "mcpServers": {
    "webcli": {
      "command": "node",
      "args": ["/Users/<user>/.runeai/mcp-server/bin/rune-mcp.js"]
    }
  }
}
```

Codex:

```bash
codex mcp add webcli --command "node" --args "/Users/<user>/.runeai/mcp-server/bin/rune-mcp.js"
```

Gemini CLI:

```bash
gemini mcp add webcli --command "node" --args "/Users/<user>/.runeai/mcp-server/bin/rune-mcp.js"
```

## 사용 가능한 MCP 도구

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `webcli_sessions` | 활성 탭 목록 | - |
| `webcli_snapshot` | 페이지 스냅샷 | tabId (선택) |
| `webcli_act` | 클릭 | targetId |
| `webcli_fill` | 입력 | targetId, value |
| `webcli_drag` | 드래그 | sourceTargetId, destinationTargetId |
| `webcli_wait` | 상태 대기 | targetId, state |
| `webcli_guide` | 시각적 가이드 | targetId |
| `webcli_config` | 런타임 설정 | pointerAnimation, auroraGlow 등 |

## 웹앱 준비

페이지에 `data-rune-*` 어노테이션이 있으면 확장 프로그램이 자동으로 대상과 그룹을 수집한다.

```html
<button data-rune-action="click" data-rune-name="Login">로그인</button>
<input data-rune-action="fill" data-rune-name="Email" type="email" />
```
