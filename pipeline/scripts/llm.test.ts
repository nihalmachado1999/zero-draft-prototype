import { describe, expect, it } from 'vitest'
import { RATE_LIMIT_MAX_WAIT_MS, rateLimitWaitMs } from './llm'

describe('rateLimitWaitMs (pipeline scripts only)', () => {
  it('waits what the provider asks, plus a second', () => {
    expect(rateLimitWaitMs('429 from Groq: Rate limit reached. Please try again in 7.66s.')).toBe(8_660)
    expect(rateLimitWaitMs('429 … Please try again in 350ms.')).toBe(1_350)
    expect(rateLimitWaitMs('RESOURCE_EXHAUSTED: Please retry in 34s')).toBe(35_000)
  })

  it('never waits more than a minute, even when asked to', () => {
    expect(rateLimitWaitMs('Please try again in 1m26.4s.')).toBe(RATE_LIMIT_MAX_WAIT_MS)
    expect(rateLimitWaitMs('Please try again in 2h3m.')).toBe(RATE_LIMIT_MAX_WAIT_MS)
  })

  it('waits 30 s when the reply does not say how long', () => {
    expect(rateLimitWaitMs('429 Too Many Requests')).toBe(30_000)
  })
})
