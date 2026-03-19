import { describe, expect, it } from 'vitest'
import { compileSource } from '../src/plugin/compiler'
import { resolveOptions } from '../src/plugin/options'

describe('compiler', () => {
  it('html에서 click target을 수집하고 추적 키를 주입한다', () => {
    const source = `
      <button data-webcli-action="click" data-webcli-name="대시보드 이동" data-webcli-desc="메인 탭 열기">Go</button>
    `

    const result = compileSource(source, 'src/app.html', resolveOptions())

    expect(result.diagnostics).toHaveLength(0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].status).toBe('active')
    expect(result.entries[0].action).toBe('click')
    expect(result.entries[0].groupId).toBe('default')
    expect(result.code).toContain('data-webcli-key="wcli_')
    expect(result.code).not.toContain('data-webcli-action=')
    expect(result.code).not.toContain('data-webcli-name=')
    expect(result.code).not.toContain('data-webcli-desc=')
  })

  it('중첩 그룹에서는 가장 가까운 상위 그룹을 사용한다', () => {
    const source = `
      <section data-webcli-group="navigation" data-webcli-group-desc="상위 네비게이션">
        <button data-webcli-action="click" data-webcli-name="home" data-webcli-desc="홈">Home</button>
        <div data-webcli-group="modal" data-webcli-group-desc="모달 조작">
          <button data-webcli-action="click" data-webcli-name="confirm" data-webcli-desc="확인">Confirm</button>
        </div>
      </section>
    `

    const result = compileSource(source, 'src/app.html', resolveOptions())

    expect(result.entries).toHaveLength(2)
    const home = result.entries.find(entry => entry.target.name === 'home')
    const confirm = result.entries.find(entry => entry.target.name === 'confirm')

    expect(home?.groupId).toBe('navigation')
    expect(home?.groupDesc).toBe('상위 네비게이션')
    expect(confirm?.groupId).toBe('modal')
    expect(confirm?.groupDesc).toBe('모달 조작')
  })

  it('jsx에서도 상위 group 메타를 수집한다', () => {
    const source = `
      const App = () => (
        <section data-webcli-group="navigation" data-webcli-group-name="Navigation" data-webcli-group-desc="상위 네비게이션">
          <button data-webcli-action="click" data-webcli-name="home" data-webcli-desc="홈">Home</button>
          <div data-webcli-group="modal" data-webcli-group-name="Modal" data-webcli-group-desc="모달 조작">
            <button data-webcli-action="click" data-webcli-name="confirm" data-webcli-desc="확인">Confirm</button>
          </div>
        </section>
      )
    `

    const result = compileSource(source, 'src/App.tsx', resolveOptions())

    expect(result.entries).toHaveLength(2)
    const home = result.entries.find(entry => entry.target.name === 'home')
    const confirm = result.entries.find(entry => entry.target.name === 'confirm')

    expect(home?.groupId).toBe('navigation')
    expect(home?.groupName).toBe('Navigation')
    expect(home?.groupDesc).toBe('상위 네비게이션')

    expect(confirm?.groupId).toBe('modal')
    expect(confirm?.groupName).toBe('Modal')
    expect(confirm?.groupDesc).toBe('모달 조작')
  })

  it('필수 속성 누락 시 컴파일 에러를 반환한다', () => {
    const source = `<button data-webcli-action="click">Go</button>`
    const result = compileSource(source, 'src/app.html', resolveOptions())

    const missing = result.diagnostics.filter(d => d.code === 'WCLI_COMPILE_MISSING_ATTR')
    expect(missing.length).toBeGreaterThan(0)
  })

  it('지원하지 않는 action은 skipped 상태로 기록하고 경고한다', () => {
    const source = `<button data-webcli-action="hover" data-webcli-name="Hover" data-webcli-desc="Hover test">Go</button>`
    const result = compileSource(source, 'src/app.html', resolveOptions())

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].status).toBe('skipped_unsupported_action')
    expect(result.diagnostics.some(d => d.code === 'WCLI_COMPILE_UNSUPPORTED_ACTION')).toBe(true)
  })

  it('fill action도 active 상태로 수집한다', () => {
    const source = `<input data-webcli-action="fill" data-webcli-name="email" data-webcli-desc="이메일 입력" />`
    const result = compileSource(source, 'src/form.html', resolveOptions())

    expect(result.diagnostics).toHaveLength(0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].status).toBe('active')
    expect(result.entries[0].action).toBe('fill')
    expect(result.code).toContain('data-webcli-key="wcli_')
  })

  it('jsx에서 동적 action은 에러로 처리한다', () => {
    const source = `<button data-webcli-action={kind} data-webcli-name="X" data-webcli-desc="Y">Go</button>`
    const result = compileSource(source, 'src/App.tsx', resolveOptions())

    expect(result.diagnostics.some(d => d.code === 'WCLI_COMPILE_DYNAMIC_ATTR')).toBe(true)
  })

  it('jsx에서 동적 name/desc는 허용하고 null로 기록한다', () => {
    const source = `<button data-webcli-action="click" data-webcli-name={title} data-webcli-desc={desc}>Go</button>`
    const result = compileSource(source, 'src/App.tsx', resolveOptions())

    expect(result.diagnostics.filter(d => d.level === 'error')).toHaveLength(0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].target.name).toBeNull()
    expect(result.entries[0].target.desc).toBeNull()
    expect(result.entries[0].action).toBe('click')
    // 동적 속성은 소스에서 제거되지 않는다
    expect(result.code).toContain('data-webcli-name={title}')
    expect(result.code).toContain('data-webcli-desc={desc}')
  })

  it('jsx에서 정적 name + 동적 desc 혼합도 허용한다', () => {
    const source = `<button data-webcli-action="click" data-webcli-name="Submit" data-webcli-desc={dynamicDesc}>Go</button>`
    const result = compileSource(source, 'src/App.tsx', resolveOptions())

    expect(result.diagnostics.filter(d => d.level === 'error')).toHaveLength(0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].target.name).toBe('Submit')
    expect(result.entries[0].target.desc).toBeNull()
    // 정적 name은 제거되고, 동적 desc는 보존된다
    expect(result.code).not.toContain('data-webcli-name="Submit"')
    expect(result.code).toContain('data-webcli-desc={dynamicDesc}')
  })

  it('html non-strict에서는 invalid node 진단 시 source attrs를 보존한다', () => {
    const source =
      '<button data-webcli-action="click" data-webcli-name="valid" data-webcli-desc="ok">OK</button><button data-webcli-action="click">Broken</button>'
    const result = compileSource(
      source,
      'src/app.html',
      resolveOptions({ strict: false }),
    )

    expect(result.entries).toHaveLength(1)
    expect(result.changed).toBe(true)
    expect(result.diagnostics.some(d => d.code === 'WCLI_COMPILE_MISSING_ATTR')).toBe(true)
    expect(result.code).toContain('data-webcli-key="wcli_')
    expect(result.code).not.toContain('data-webcli-name="valid"')
    expect(result.code).toContain('<button data-webcli-action="click">Broken</button>')
  })

  it('jsx non-strict에서는 invalid node 진단 시 source attrs를 보존한다', () => {
    const source =
      'const App = () => (<><button data-webcli-action="click" data-webcli-name="valid" data-webcli-desc="ok">OK</button><button data-webcli-action="click">Broken</button></>)'
    const result = compileSource(
      source,
      'src/App.tsx',
      resolveOptions({ strict: false }),
    )

    expect(result.entries).toHaveLength(1)
    expect(result.changed).toBe(true)
    expect(result.diagnostics.some(d => d.code === 'WCLI_COMPILE_MISSING_ATTR')).toBe(true)
    expect(result.code).toContain('data-webcli-key="wcli_')
    expect(result.code).not.toContain('data-webcli-name="valid"')
    expect(result.code).toContain('<button data-webcli-action="click">Broken</button>')
  })

  it('동일 입력에서는 targetId가 결정적으로 생성된다', () => {
    const source = `
      <button data-webcli-action="click" data-webcli-name="대시보드 이동" data-webcli-desc="메인 탭 열기">Go</button>
    `
    const options = resolveOptions()
    const a = compileSource(source, 'src/app.html', options)
    const b = compileSource(source, 'src/app.html', options)

    expect(a.entries).toHaveLength(1)
    expect(b.entries).toHaveLength(1)
    expect(a.entries[0].target.targetId).toBe(b.entries[0].target.targetId)
  })
})
