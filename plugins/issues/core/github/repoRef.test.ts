import { describe, expect, it } from 'vitest'
import { parseOwnerName, resolveRepoRef } from './repoRef'

const ACME = { owner: 'acme', name: 'repo' }

describe('parseOwnerName', () => {
  it('accepts bare hints, https, scp-style and ssh remotes', () => {
    expect(parseOwnerName('acme/repo')).toEqual(ACME)
    expect(parseOwnerName('acme/repo/')).toEqual(ACME)
    expect(parseOwnerName('https://github.com/acme/repo')).toEqual(ACME)
    expect(parseOwnerName('https://github.com/acme/repo.git')).toEqual(ACME)
    expect(parseOwnerName('git@github.com:acme/repo.git')).toEqual(ACME)
    expect(parseOwnerName('ssh://git@github.com/acme/repo.git')).toEqual(ACME)
  })

  it('takes the first two segments when the url carries extra path', () => {
    expect(parseOwnerName('https://github.com/acme/repo/extra/path')).toEqual(ACME)
  })

  it('rejects inputs that carry no owner/name pair', () => {
    expect(parseOwnerName('')).toBeNull()
    expect(parseOwnerName('   ')).toBeNull()
    expect(parseOwnerName('acme')).toBeNull()
    expect(parseOwnerName('https://github.com/acme')).toBeNull()
  })
})

describe('resolveRepoRef', () => {
  const base = { projectName: 'acme', override: null, gitRemoteUrl: null }

  it('prefers the override over the git remote', () => {
    expect(
      resolveRepoRef({ ...base, override: 'acme/repo', gitRemoteUrl: 'git@github.com:other/thing.git' }),
    ).toEqual(ACME)
  })

  it('falls back to the git remote when there is no override', () => {
    expect(resolveRepoRef({ ...base, gitRemoteUrl: 'git@github.com:acme/repo.git' })).toEqual(ACME)
  })

  it('falls back to the git remote when the override is unparseable', () => {
    expect(
      resolveRepoRef({ ...base, override: 'not-a-repo', gitRemoteUrl: 'https://github.com/acme/repo' }),
    ).toEqual(ACME)
  })

  it('explains how to fix a project with no git remote', () => {
    expect(() => resolveRepoRef(base)).toThrow(/No GitHub repository found for acme/)
  })

  it('reports a remote that carries no owner/name pair', () => {
    expect(() => resolveRepoRef({ ...base, gitRemoteUrl: 'bare-repo' })).toThrow(
      /Could not read a GitHub owner\/name/,
    )
  })
})
