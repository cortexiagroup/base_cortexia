import { describe, expect, it } from 'vitest'
import { modules, zones } from './modules'
import { totalConfirmedXof } from './dashboard'

describe('navigation configuration', () => {
  it('maps each scene zone to a reachable module', () => {
    for (const zone of zones) expect(modules.some(module => module.id === zone.moduleId)).toBe(true)
  })
  it('has six distinct scene zones', () => {
    expect(new Set(zones.map(zone => zone.id)).size).toBe(6)
  })
})

describe('financial totals', () => {
  it('includes confirmed partial payments and excludes pending payments without precision loss', () => {
    expect(totalConfirmedXof([
      { amount_xof: '25000', status: 'confirmed' },
      { amount_xof: '24000', status: 'confirmed' },
      { amount_xof: '9007199254740993', status: 'pending' },
    ])).toBe(49000n)
  })
})
