import { describe, expect, it } from 'vitest'
import { SETTINGS } from './settings'

const schema = SETTINGS.rescanMinutes.experimental_schema

async function accepts(value: number): Promise<boolean> {
  const result = await schema['~standard'].validate(value)
  return !result.issues
}

describe('rescanMinutes setting', () => {
  it('defaults to five minutes', () => {
    expect(SETTINGS.rescanMinutes.default).toBe(5)
  })

  it('accepts whole minutes from 1 to 240', async () => {
    expect(await accepts(1)).toBe(true)
    expect(await accepts(240)).toBe(true)
  })

  it('rejects a value outside the range or between whole minutes', async () => {
    expect(await accepts(0)).toBe(false)
    expect(await accepts(241)).toBe(false)
    expect(await accepts(2.5)).toBe(false)
  })
})
