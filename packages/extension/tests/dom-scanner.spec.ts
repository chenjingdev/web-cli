import { describe, it, expect } from 'vitest'
import { scanAnnotations, scanGroups } from '../src/content/dom-scanner'
import type { ScannedTarget } from '../src/content/dom-scanner'

describe('scanAnnotations', () => {
  it('returns empty array when no annotations exist', () => {
    document.body.innerHTML = '<div>Hello</div>'
    const result = scanAnnotations(document)
    expect(result).toEqual([])
  })

  it('finds elements with data-rune-action and extracts metadata', () => {
    document.body.innerHTML = `
      <button
        data-rune-action="click"
        data-rune-name="submit-btn"
        data-rune-desc="Submits the form"
      >Submit</button>
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'submit-btn',
      description: 'Submits the form',
      actionKind: 'click',
      sensitive: false,
    })
    expect(result[0].targetId).toBe('wcli_0')
    expect(result[0].selector).toBe('[data-rune-name="submit-btn"]')
  })

  it('uses data-rune-key for targetId and selector', () => {
    document.body.innerHTML = `
      <input
        data-rune-action="fill"
        data-rune-name="email"
        data-rune-desc="Email input"
        data-rune-key="email-field"
      />
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].targetId).toBe('email-field')
    expect(result[0].selector).toBe('[data-rune-key="email-field"]')
    expect(result[0].actionKind).toBe('fill')
  })

  it('handles data-rune-sensitive flag', () => {
    document.body.innerHTML = `
      <input
        data-rune-action="fill"
        data-rune-name="password"
        data-rune-desc="Password input"
        data-rune-sensitive
      />
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].sensitive).toBe(true)
  })

  it('extracts group info from ancestor', () => {
    document.body.innerHTML = `
      <div data-rune-group="login-form" data-rune-group-name="Login Form" data-rune-group-desc="The login form">
        <button
          data-rune-action="click"
          data-rune-name="login-btn"
          data-rune-desc="Login button"
        >Login</button>
      </div>
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('login-form')
  })

  it('handles multiple annotated elements', () => {
    document.body.innerHTML = `
      <button data-rune-action="click" data-rune-name="btn1" data-rune-desc="First">1</button>
      <button data-rune-action="click" data-rune-name="btn2" data-rune-desc="Second">2</button>
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(2)
    expect(result[0].targetId).toBe('wcli_0')
    expect(result[1].targetId).toBe('wcli_1')
  })

  it('defaults missing name and description to empty string', () => {
    document.body.innerHTML = `<button data-rune-action="click">Go</button>`
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('')
    expect(result[0].description).toBe('')
  })
})

describe('scanGroups', () => {
  it('returns empty array when no groups exist', () => {
    document.body.innerHTML = '<div>Hello</div>'
    const result = scanGroups(document)
    expect(result).toEqual([])
  })

  it('extracts group metadata', () => {
    document.body.innerHTML = `
      <div
        data-rune-group="auth"
        data-rune-group-name="Authentication"
        data-rune-group-desc="Auth section"
      >
        <button data-rune-action="click" data-rune-name="login" data-rune-desc="Login">Login</button>
      </div>
    `
    const result = scanGroups(document)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      groupId: 'auth',
      name: 'Authentication',
      description: 'Auth section',
    })
  })

  it('defaults missing group name and description to empty string', () => {
    document.body.innerHTML = `<div data-rune-group="my-group"><span>Content</span></div>`
    const result = scanGroups(document)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      groupId: 'my-group',
      name: '',
      description: '',
    })
  })
})
