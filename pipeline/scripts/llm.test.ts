import { describe, expect, it } from 'vitest'
import { isDailyLimit, orcaReasoning, provider, RATE_LIMIT_MAX_WAIT_MS, rateLimitWaitMs } from './llm'

describe('provider priority', () => {
  const orca = { ORCA_API_KEY: 'k', ORCA_MODEL: 'deepseek/deepseek-v4.1-flash-free' }
  const groq = { GROQ_API_KEY: 'k', GROQ_MODEL: 'openai/gpt-oss-120b' }
  const gemini = { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.5-flash' }

  it('uses OrcaRouter first when its key and model are both set', () => {
    expect(provider({ ...orca, ...groq, ...gemini })).toBe('orca')
    expect(provider(orca)).toBe('orca')
  })

  it('falls back to Groq when OrcaRouter is missing its key or its model', () => {
    expect(provider({ ...groq, ORCA_API_KEY: 'k' })).toBe('groq')
    expect(provider({ ...groq, ORCA_MODEL: 'deepseek/deepseek-v4.1-flash-free' })).toBe('groq')
    expect(provider({ ...groq, ORCA_API_KEY: '  ', ORCA_MODEL: 'm' })).toBe('groq')
  })

  it('uses Groq when only Groq is set, and Gemini when neither is', () => {
    expect(provider({ ...groq, ...gemini })).toBe('groq')
    expect(provider(gemini)).toBe('gemini')
    expect(provider({})).toBe('gemini')
  })
})

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

describe('isDailyLimit (pipeline scripts only)', () => {
  it('knows a spent daily request allowance from a per-minute limit', () => {
    expect(isDailyLimit('429 RESOURCE_EXHAUSTED quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit: 20')).toBe(true)
    expect(isDailyLimit('429 RESOURCE_EXHAUSTED quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier. Please retry in 34s')).toBe(false)
  })

  it('still waits on Groq’s tokens-per-day bucket, which refills by the minute', () => {
    expect(isDailyLimit('429 from Groq: Rate limit reached on tokens per day (TPD): Limit 200000. Please try again in 10m52s.')).toBe(false)
  })
})

describe('orcaReasoning', () => {
  it('switches thinking off for MINIMAL, so a capped answer is not eaten by thinking', () => {
    expect(orcaReasoning('MINIMAL')).toEqual({ thinking: { type: 'disabled' } })
  })

  it('maps the other levels to reasoning_effort, and sends nothing when unset', () => {
    expect(orcaReasoning('LOW')).toEqual({ reasoning_effort: 'low' })
    expect(orcaReasoning('MEDIUM')).toEqual({ reasoning_effort: 'medium' })
    expect(orcaReasoning('HIGH')).toEqual({ reasoning_effort: 'high' })
    expect(orcaReasoning(undefined)).toEqual({})
  })
})
