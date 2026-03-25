import { describe, it, expect } from 'vitest'
import { scanAnnotations, scanGroups } from '../src/content/dom-scanner'
import type { ScannedTarget } from '../src/content/dom-scanner'

describe('scanAnnotations', () => {
  it('returns empty array when no annotations exist', () => {
    document.body.innerHTML = '<div>Hello</div>'
    const result = scanAnnotations(document)
    expect(result).toEqual([])
  })

  it('finds elements with data-agrune-action and extracts metadata', () => {
    document.body.innerHTML = `
      <button
        data-agrune-action="click"
        data-agrune-name="submit-btn"
        data-agrune-desc="Submits the form"
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
    expect(result[0].targetId).toBe('agrune_0')
    expect(result[0].selector).toBe('[data-agrune-name="submit-btn"]')
  })

  it('uses data-agrune-key for targetId and selector', () => {
    document.body.innerHTML = `
      <input
        data-agrune-action="fill"
        data-agrune-name="email"
        data-agrune-desc="Email input"
        data-agrune-key="email-field"
      />
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].targetId).toBe('email-field')
    expect(result[0].selector).toBe('[data-agrune-key="email-field"]')
    expect(result[0].actionKind).toBe('fill')
  })

  it('handles data-agrune-sensitive flag', () => {
    document.body.innerHTML = `
      <input
        data-agrune-action="fill"
        data-agrune-name="password"
        data-agrune-desc="Password input"
        data-agrune-sensitive
      />
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].sensitive).toBe(true)
  })

  it('extracts group info from ancestor', () => {
    document.body.innerHTML = `
      <div data-agrune-group="login-form" data-agrune-group-name="Login Form" data-agrune-group-desc="The login form">
        <button
          data-agrune-action="click"
          data-agrune-name="login-btn"
          data-agrune-desc="Login button"
        >Login</button>
      </div>
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('login-form')
  })

  it('handles multiple annotated elements', () => {
    document.body.innerHTML = `
      <button data-agrune-action="click" data-agrune-name="btn1" data-agrune-desc="First">1</button>
      <button data-agrune-action="click" data-agrune-name="btn2" data-agrune-desc="Second">2</button>
    `
    const result = scanAnnotations(document)
    expect(result).toHaveLength(2)
    expect(result[0].targetId).toBe('agrune_0')
    expect(result[1].targetId).toBe('agrune_1')
  })

  it('defaults missing name and description to empty string', () => {
    document.body.innerHTML = `<button data-agrune-action="click">Go</button>`
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
        data-agrune-group="auth"
        data-agrune-group-name="Authentication"
        data-agrune-group-desc="Auth section"
      >
        <button data-agrune-action="click" data-agrune-name="login" data-agrune-desc="Login">Login</button>
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
    document.body.innerHTML = `<div data-agrune-group="my-group"><span>Content</span></div>`
    const result = scanGroups(document)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      groupId: 'my-group',
      name: '',
      description: '',
    })
  })
})
