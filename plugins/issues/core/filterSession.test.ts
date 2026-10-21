import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearIssuesFilterSession,
  readIssuesFilterSelection,
  updateIssuesFilterSelection,
} from './filterSession'

describe('issues filter session', () => {
  beforeEach(() => {
    clearIssuesFilterSession()
  })

  it('starts from every issue and no value chips', () => {
    expect(readIssuesFilterSelection('proj-1')).toEqual({
      threadMode: 'all',
      dependencyMode: 'all',
      values: [],
    })
  })

  it('keeps each control for one project and leaves the other project alone', () => {
    updateIssuesFilterSelection('proj-1', { threadMode: 'without' })
    updateIssuesFilterSelection('proj-1', { dependencyMode: 'unblocked' })
    updateIssuesFilterSelection('proj-1', { values: [3, 'none'] })
    updateIssuesFilterSelection('proj-2', { threadMode: 'with' })

    expect(readIssuesFilterSelection('proj-1')).toEqual({
      threadMode: 'without',
      dependencyMode: 'unblocked',
      values: [3, 'none'],
    })
    expect(readIssuesFilterSelection('proj-2')).toEqual({
      threadMode: 'with',
      dependencyMode: 'all',
      values: [],
    })
  })

  it('stores a copy, so a later edit of the returned chips does not change the session', () => {
    updateIssuesFilterSelection('proj-1', { values: [1] })

    const first = readIssuesFilterSelection('proj-1')
    first.values.push(9)

    expect(readIssuesFilterSelection('proj-1').values).toEqual([1])
  })

  it('can clear the value chips without clearing the other controls', () => {
    updateIssuesFilterSelection('proj-1', { threadMode: 'without', values: [4] })
    updateIssuesFilterSelection('proj-1', { values: [] })

    expect(readIssuesFilterSelection('proj-1')).toEqual({
      threadMode: 'without',
      dependencyMode: 'all',
      values: [],
    })
  })

  it('ignores a missing project id', () => {
    updateIssuesFilterSelection(null, { threadMode: 'without' })

    expect(readIssuesFilterSelection(null).threadMode).toBe('all')
  })
})
