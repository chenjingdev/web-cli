# 어노테이션 검증 패키지 아이디어

## 배경

- `@agrune/build-core`는 런타임 엔진이지 Vite 플러그인이 아님
- annotate 스킬의 Vite 플러그인 섹션(`agruneDomPlugin()`, `@agagrune/build-core/register`)은 미구현 상태
- 현재 사용자 웹앱에는 agrune 패키지 의존성이 없음 — 확장이 런타임을 직접 주입

## 아이디어

빌드 타임에 어노테이션을 검증하는 패키지를 별도로 만들기:

- 어노테이션이 제대로 안 붙었을 때 빌드 시 오류/경고 출력
- Vite 플러그인 또는 ESLint 플러그인 형태 가능

## 검토할 점

- 어떤 검증을 할 것인가? (필수 속성 누락, action 값 오류, name 중복 등)
- 빌드 에러 vs 경고?
- Vite 플러그인 vs ESLint 규칙 vs 독립 CLI 도구?
- 사용자 웹앱에 devDependency로 추가하는 형태

## 현재 상태

미착수. quickstart 스킬 완성 후 별도 논의 예정.
