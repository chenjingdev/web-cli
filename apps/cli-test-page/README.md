# @agrune/test-page

`agrune` 개발용 검증 앱이다.

## 실행

```bash
pnpm -C apps/cli-test-page dev
```

확장 프로그램과 MCP 설치는 루트에서 준비한다.

```bash
pnpm install
pnpm dlx tsx packages/mcp-server/bin/agrune-mcp.ts install
```

그다음 `chrome://extensions`에서 `~/.agrune/extension/`을 로드하고 이 앱을 열어 검증한다.

## 포인트

- React UI 위에 `data-agrune-*` 어노테이션이 붙어 있다.
- 확장 프로그램이 탭, 그룹, 타깃 정보를 자동 수집한다.
- 드래그, 클릭, 입력, 대기 동작을 수동 검증하기 위한 fixture로 유지한다.
