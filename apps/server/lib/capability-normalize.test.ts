import { describe, it, expect } from 'vitest'
import { normalizeCapability } from './capability-normalize.js'

describe('normalizeCapability', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(normalizeCapability('Code Review')).toBe('code-review')
  })

  it('collapses underscores into hyphens', () => {
    expect(normalizeCapability('pr_review')).toBe('pr-review')
  })

  it('strips characters outside [a-z0-9-]', () => {
    expect(normalizeCapability('C++ Development!')).toBe('c-development')
  })

  it('collapses repeated hyphens and trims leading/trailing ones', () => {
    expect(normalizeCapability('  --data--science--  ')).toBe('data-science')
  })

  it('is idempotent on an already-normalized tag', () => {
    expect(normalizeCapability('data-science')).toBe('data-science')
  })
})
