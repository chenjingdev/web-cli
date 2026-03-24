# 프로세스 간 통신(IPC) 패턴 정리

브라우저 확장 프로그램과 로컬 애플리케이션 간 통신 방식 비교.

## 1. Chrome Native Messaging

Chrome이 확장 프로그램과 로컬 앱을 연결하기 위해 제공하는 전용 API.

```
Chrome Extension (Service Worker)
    ↓  chrome.runtime.connectNative("host-name")
Chrome 브라우저 (중개)
    ↓  stdin/stdout 파이프
Native Host 바이너리 (로컬 프로세스)
```

**메시지 포맷**: `[4바이트 LE 길이][JSON 바이트]`

```
┌──────────┬─────────────────────┐
│ 4 bytes  │ N bytes             │
│ (uint32) │ (UTF-8 JSON)        │
│ length=N │ {"type":"session"…} │
└──────────┴─────────────────────┘
```

**설정 파일 (macOS)**:
```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.example.host.json
```

```json
{
  "name": "com.example.host",
  "description": "My native host",
  "path": "/path/to/binary",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://EXTENSION_ID/"]
}
```

**특징**:
- 네트워크 안 탐 (OS 파이프)
- Chrome이 extension ID 자동 검증
- 포트 불필요
- HTTPS 혼합 콘텐츠 문제 없음
- Chrome 전용 API

**한계**:
- stdin/stdout 하나만 사용 가능 → 다른 프로세스와 공유 불가
- 메시지 최대 1MB

---

## 2. WebSocket

TCP 위의 양방향 전이중 통신 프로토콜.

```
Browser (웹 페이지 JS)
    ↓  new WebSocket("ws://localhost:9444")
WebSocket 서버 (로컬 프로세스)
```

**특징**:
- 웹 표준 (브라우저 종속 없음)
- 양방향 실시간 통신
- 어떤 언어/환경에서든 구현 가능

**한계**:
- HTTPS 페이지 → ws://localhost 차단 가능 (혼합 콘텐츠)
- localhost 포트 점유 필요
- 포트 충돌 가능성
- 인증을 직접 구현해야 함

---

## 3. Unix Domain Socket

같은 머신의 두 프로세스가 파일 경로로 통신. 네트워크를 안 탐.

```
프로세스 A
    ↓  connect("/tmp/my.sock")
소켓 파일
    ↑  listen("/tmp/my.sock")
프로세스 B
```

**특징**:
- TCP보다 빠름 (네트워크 스택 안 거침)
- 포트 번호 불필요 (파일 경로 사용)
- 같은 머신에서만 동작

**한계**:
- 소켓 파일 lifecycle 관리 필요 (프로세스 죽으면 파일 남음)
- Windows 지원 제한적
- 파일 권한 관리 필요

---

## 4. TCP (localhost)

로컬 TCP 포트로 프로세스 간 통신.

```
프로세스 A
    ↓  connect(127.0.0.1:19444)
    ↑  listen(127.0.0.1:19444)
프로세스 B
```

**특징**:
- 단순하고 안정적
- 파일 관리 불필요
- 모든 OS에서 동일하게 동작
- 포트 0으로 OS가 랜덤 포트 할당 가능

**한계**:
- 포트 충돌 가능 (랜덤 포트로 해결)
- localhost라도 다른 프로세스가 접속 가능 (보안 주의)

---

## 5. MCP (Model Context Protocol)

AI Agent와 도구 서버 간 통신 프로토콜. Anthropic 제안.

```
AI Agent (Claude Code, Codex, Gemini CLI)
    ↓  MCP 프로토콜 (JSON-RPC over stdio)
MCP 서버
    ↓  도구 실행
결과 반환
```

**특징**:
- AI Agent가 도구를 자동으로 인식/호출
- JSON-RPC 2.0 기반
- stdio 전송 (Agent가 MCP 서버를 자식 프로세스로 실행)
- 도구 스키마 자동 노출 (Zod로 정의)

**구조**:
```json
// 도구 목록 요청
{ "method": "tools/list" }

// 도구 호출
{ "method": "tools/call", "params": { "name": "webcli_act", "arguments": { "targetId": "btn-1" } } }
```

---

## rune에서의 조합

rune은 4가지를 조합:

```
[브라우저 페이지]
    ↕ window.postMessage (main world ↔ content script)
[Extension content script]
    ↕ chrome.runtime (content script ↔ service worker)
[Extension service worker]
    ↕ Native Messaging (service worker ↔ Native Host)
[Native Host 프로세스]
    ↕ TCP localhost (Native Host ↔ MCP 서버)
[MCP 서버 프로세스]
    ↕ MCP/stdio (MCP 서버 ↔ AI Agent)
[AI Agent (Claude Code)]
```

**왜 이렇게 복잡한가?**

각 구간의 stdin/stdout이 이미 점유되어 있기 때문:
- MCP 서버의 stdin/stdout → AI Agent가 MCP 프로토콜로 사용
- Native Host의 stdin/stdout → Chrome이 Native Messaging으로 사용
- 따라서 MCP 서버와 Native Host 사이에 TCP라는 제3 채널이 필요

Claude Code는 이 문제가 없음 — 단일 바이너리라서 내부적으로 모든 걸 처리.
