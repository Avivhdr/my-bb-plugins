// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isTypingTarget, isSearchFocusKey } from './searchHotkey'

function keydown(key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...mods })
}

describe('isTypingTarget', () => {
  it('is true for an input element', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
  })

  it('is true for a textarea element', () => {
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
  })

  it('is true for a contenteditable element', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    document.body.append(div)
    expect(isTypingTarget(div)).toBe(true)
    div.remove()
  })

  it('is true for a child of a contenteditable element', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    const span = document.createElement('span')
    div.append(span)
    document.body.append(div)
    expect(isTypingTarget(span)).toBe(true)
    div.remove()
  })

  it('is false for a plain element', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
  })

  it('is false for null', () => {
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('isSearchFocusKey', () => {
  it('is true for a bare "/"', () => {
    expect(isSearchFocusKey(keydown('/'))).toBe(true)
  })

  it('is false for a modified "/" (e.g. Cmd+/)', () => {
    expect(isSearchFocusKey(keydown('/', { metaKey: true }))).toBe(false)
    expect(isSearchFocusKey(keydown('/', { ctrlKey: true }))).toBe(false)
    expect(isSearchFocusKey(keydown('/', { altKey: true }))).toBe(false)
  })

  it('is false for any other key', () => {
    expect(isSearchFocusKey(keydown('a'))).toBe(false)
  })
})
