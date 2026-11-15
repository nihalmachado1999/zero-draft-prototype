import { afterEach, describe, expect, it, vi } from 'vitest'
import { complete, isDailyLimit, orcaReasoning, provider, providers, RATE_LIMIT_MAX_WAIT_MS, rateLimitWaitMs } from './llm'

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

describe('providers (the order they are tried)', () => {
  const orca = { ORCA_API_KEY: 'k', ORCA_MODEL: 'deepseek/deepseek-v4.1-flash-free' }
  const groq = { GROQ_API_KEY: 'k', GROQ_MODEL: 'openai/gpt-oss-120b' }
  const gemini = { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.5-flash' }

  it('lists every provider with keys set: OrcaRouter, then Groq, then Gemini', () => {
    expect(providers({ ...gemini, ...groq, ...orca })).toEqual(['orca', 'groq', 'gemini'])
    expect(providers({ ...orca, ...gemini })).toEqual(['orca', 'gemini'])
    expect(providers(groq)).toEqual(['groq'])
  })

  it('lists Gemini alone when nothing is set, so the error says what to set', () => {
    expect(providers({})).toEqual(['gemini'])
    expect(provider({})).toBe('gemini')
  })
})

describe('complete falls back to the next provider', () => {
  const chat = (model: string, content = 'ok') =>
    new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 })
  const fail = (status: number, text: string) => new Response(text, { status })

  function setEnv(names: string[]) {
    const all: Record<string, string> = {
      ORCA_API_KEY: 'ok', ORCA_MODEL: 'deepseek/deepseek-v4.1-flash-free',
      GROQ_API_KEY: 'gk', GROQ_MODEL: 'openai/gpt-oss-120b',
      GEMINI_API_KEY: '', GEMINI_MODEL: '',
    }
    for (const [key, value] of Object.entries(all)) vi.stubEnv(key, names.includes(key.split('_')[0].toLowerCase()) ? value : '')
  }
  const request = { system: 's', user: 'u', timeoutMs: 10_000 }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('answers from OrcaRouter and never calls Groq when OrcaRouter works', async () => {
    setEnv(['orca', 'groq'])
    const fetchMock = vi.fn().mockResolvedValueOnce(chat('deepseek/deepseek-v4.1-flash-free'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await complete(request)
    expect(result.model).toBe('deepseek/deepseek-v4.1-flash-free')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('orcarouter.ai')
  })

  it('falls back to Groq when OrcaRouter fails, and the result names the model that answered', async () => {
    setEnv(['orca', 'groq'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(402, 'out of credits'))
      .mockResolvedValueOnce(chat('openai/gpt-oss-120b'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await complete(request)
    expect(result.model).toBe('openai/gpt-oss-120b')
    expect(result.text).toBe('ok')
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.orcarouter.ai/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
    ])
  })

  it('falls back when OrcaRouter is unreachable', async () => {
    setEnv(['orca', 'groq'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(chat('openai/gpt-oss-120b')))
    expect((await complete(request)).model).toBe('openai/gpt-oss-120b')
  })

  it('does not wait out a rate limit on a provider that has a fallback behind it', async () => {
    setEnv(['orca', 'groq'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(500, 'Rate limit reached. Please try again in 50s'))
      .mockResolvedValueOnce(chat('openai/gpt-oss-120b'))
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    await complete({ ...request, rateLimitRetries: 2 })
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('throws one error naming every provider when all of them fail', async () => {
    setEnv(['orca', 'groq'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(fail(402, 'out of credits'))
      .mockResolvedValueOnce(fail(401, 'bad key')))
    await expect(complete(request)).rejects.toThrow(/All LLM providers failed.*OrcaRouter.*402.*Groq.*401/s)
  })

  it('with one provider, throws that provider’s own error', async () => {
    setEnv(['groq'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fail(401, 'bad key')))
    await expect(complete(request)).rejects.toThrow(/^401 from Groq: bad key/)
  })
})
