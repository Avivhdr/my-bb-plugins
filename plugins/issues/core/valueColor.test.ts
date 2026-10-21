import { describe, expect, it } from 'vitest'
import { valueBandColor } from './valueColor'

describe('valueBandColor', () => {
  it('bands 7..10 as red', () => {
    expect(valueBandColor(7)).toBe('dc2626')
    expect(valueBandColor(10)).toBe('dc2626')
  })

  it('bands 4..6 as orange', () => {
    expect(valueBandColor(4)).toBe('f97316')
    expect(valueBandColor(6)).toBe('f97316')
  })

  it('bands 0..3 as yellow', () => {
    expect(valueBandColor(0)).toBe('eab308')
    expect(valueBandColor(3)).toBe('eab308')
  })
})
