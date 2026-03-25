# AI Agent 연동 가이드

`agrune`은 Chrome 확장 프로그램과 `agrune-mcp`를 통해 AI Agent가 브라우저를 직접 제어하도록 구성된다.

## 사전 준비

1. 저장소에서 의존성 설치: `pnpm install`
2. 설치 실행: `pnpm dlx tsx packages/mcp-server/bin/agrune-mcp.ts install`
3. `chrome://extensions`에서 `~/.agrune/extension/`을 로드

## Agent 등록

Claude Code:

```json
{
  "mcpServers": {
    "agrune": {
      "command": "node",
      "args": ["/Users/<user>/.agrune/mcp-server/bin/agrune-mcp.js"]
    }
  }
}
```

Codex:

```bash
codex mcp add agrune --command "node" --args "/Users/<user>/.agrune/mcp-server/bin/agrune-mcp.js"
```

Gemini CLI:

```bash
gemini mcp add agrune --command "node" --args "/Users/<user>/.agrune/mcp-server/bin/agrune-mcp.js"
```

## 사용 가능한 MCP 도구

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `agrune_sessions` | 활성 탭 목록 | - |
| `agrune_snapshot` | 페이지 스냅샷 | tabId (선택) |
| `agrune_act` | 클릭 | targetId |
| `agrune_fill` | 입력 | targetId, value |
| `agrune_drag` | 드래그 | sourceTargetId, destinationTargetId |
| `agrune_wait` | 상태 대기 | targetId, state |
| `agrune_guide` | 시각적 가이드 | targetId |
| `agrune_config` | 런타임 설정 | pointerAnimation, auroraGlow 등 |

## 웹앱 준비

페이지에 `data-agrune-*` 어노테이션이 있으면 확장 프로그램이 자동으로 대상과 그룹을 수집한다.

```html
<button data-agrune-action="click" data-agrune-name="Login">로그인</button>
<input data-agrune-action="fill" data-agrune-name="Email" type="email" />
```
