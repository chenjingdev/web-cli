# @webcli-dom/build-core

`data-webcli-*` 선언형 DOM을 빌드 타임에 수집/검증하고 `window.webcliDom` page runtime으로 연결합니다.

## 설치

```bash
pnpm add @webcli-dom/build-core
```

## Vite 사용

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import webCliDomPlugin from '@webcli-dom/build-core'

export default defineConfig({
  plugins: [webCliDomPlugin()],
})
```

```ts
// main.ts
import '@webcli-dom/build-core/register'
```

## DSL

### 타겟(요소) 레벨

필수:
- `data-webcli-action`
- `data-webcli-name`
- `data-webcli-desc`

선택:
- `data-webcli-key`
- `data-webcli-group`

### 그룹 레벨

선택:
- `data-webcli-group-name`
- `data-webcli-group-desc`

### 설명 우선순위

툴 설명(manifest metadata):
1. `data-webcli-group-desc`
2. 자동 생성

버튼 설명(`data-webcli-desc`)은 각 target 설명으로 manifest에 기록됩니다.

### 중첩 그룹

중첩 시 **가장 가까운 상위 그룹**이 적용됩니다.

## 옵션

```ts
webCliDomPlugin({
  exposureMode: 'grouped', // default
  groupAttr: 'data-webcli-group',
  unsupportedActionHandling: 'warn-skip',
  preserveSourceAttrs: false,
  emitTrackingAttr: 'debug',
  click: {
    autoScroll: true,
    retryCount: 2,
    retryDelayMs: 120,
  },
})
```

## 런타임 동작

- `window.webcliDom = { getSnapshot, act, fill, wait }` 전역을 설치합니다.
- v1 실행 액션은 `click`, `fill` 입니다.
- `wait`는 별도 DOM 상태 verb로 런타임에서 처리합니다.
- dev HMR에서 manifest가 바뀌면 기존 runtime을 정리하고 재설치합니다.
- `webcli.manifest.json` 파일은 build 결과물에서 생성됩니다.
  - dev 중 최신 값은 virtual module(`@webcli-dom/build-core/manifest`) 기준으로 동작합니다.
