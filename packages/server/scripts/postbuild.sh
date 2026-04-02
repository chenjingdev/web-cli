#!/bin/sh
# postbuild.sh — dist를 배포 대상에 동기화하고 데몬을 재시작한다.

# 1. 플러그인 배포 레포 (agrune/skills) — 유저에게 배포되는 소스
MONOREPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
PLUGIN_REPO_MCP="${MONOREPO_ROOT:+$MONOREPO_ROOT/../skills/mcp-server}"

if [ -d "$PLUGIN_REPO_MCP" ]; then
  rm -rf "$PLUGIN_REPO_MCP"/*
  cp -r dist/* "$PLUGIN_REPO_MCP"/
  echo "[postbuild] Synced dist → $PLUGIN_REPO_MCP"
fi

# 2. Native messaging host (Chrome 확장 ↔ MCP 서버 통신용)
NATIVE_HOST_DIR="$HOME/.agrune/mcp-server"

if [ -d "$NATIVE_HOST_DIR" ]; then
  rm -rf "$NATIVE_HOST_DIR"/*
  cp -r dist/* "$NATIVE_HOST_DIR"/
  echo "[postbuild] Synced dist → $NATIVE_HOST_DIR"
fi

# 3. 로컬 개발: Claude Code 플러그인 캐시 (빌드 즉시 반영용)
PLUGIN_CACHE_DIR="$HOME/.claude/plugins/marketplaces/agrune/mcp-server"

if [ -d "$PLUGIN_CACHE_DIR" ]; then
  rm -rf "$PLUGIN_CACHE_DIR"/*
  cp -r dist/* "$PLUGIN_CACHE_DIR"/
  echo "[postbuild] Synced dist → $PLUGIN_CACHE_DIR"
fi

# 4. 백엔드 데몬 종료 (다음 MCP 요청 시 자동 재시작)
lsof -ti tcp:47654 | xargs kill 2>/dev/null && \
  echo "[postbuild] Killed backend daemon on port 47654." || \
  echo "[postbuild] No running daemon found."
