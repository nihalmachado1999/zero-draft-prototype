// The one module that talks to Gemini (SPEC §7.3). Nothing else imports @google/genai; the
// pipeline scripts and api/ call complete() from here.
//
// The key and model come from GEMINI_API_KEY and GEMINI_MODEL: .env.local on this machine
// (scripts call loadLocalEnv()), Vercel environment variables when deployed. No model name is
// hardcoded.
import { existsSync } from 'node:fs'
import { GoogleGenAI, type FunctionDeclaration, type ThinkingLevel } from '@google/genai'

export type CompleteRequest = {
  system: string
  user: string
  /** Function declarations for Gemini's function calling (Lab Partner's tools). */
  tools?: FunctionDeclaration[]
  /** Ask for JSON output (the pipeline). */
  json?: boolean
  /** With json: the JSON Schema the reply must follow. */
  jsonSchema?: Record<string, unknown>
  /** Cap on the reply's length, in tokens (Lab Partner's answers: 400, SPEC F5). */
  maxOutputTokens?: number
  /** How much the model thinks before answering; lower is faster. Left to the model when unset. */
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
  /** Defaults to 0, as the pipeline needs. */
  temperature?: number
  /** Give up after this long, in ms. Defaults to 60 s. */
  timeoutMs?: number
}

export type CompleteResult = {
  text: string
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>
  /** The model that answered, to record next to every output. */
  model: string
  /** Why it stopped: "STOP", or "MAX_TOKENS" when the reply was cut off. */
  finishReason?: string
  /** Tokens it wrote, and how many of those were thinking. */
  usage?: { output: number; thinking: number }
}

/** Loads .env.local into process.env when it exists (scripts only; Vercel sets env vars itself). */
export function loadLocalEnv(path = '.env.local'): void {
  if (existsSync(path)) process.loadEnvFile(path)
}

function requireEnv(name: 'GEMINI_API_KEY' | 'GEMINI_MODEL'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not set. Put it in .env.local, or in Vercel's environment variables.`)
  }
  return value
}

let client: GoogleGenAI | undefined

/** Gemini's "busy" answers: try again shortly. Anything else is a real failure. */
function isBusy(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(text)
}

const RETRY_DELAYS_MS = [800, 2000]

/**
 * One call to Gemini. A busy reply (503, 429) is retried twice, after 0.8 s and 2 s, as long as
 * the call's time limit allows; any other error is thrown at once.
 */
export async function complete(request: CompleteRequest): Promise<CompleteResult> {
  const deadline = Date.now() + (request.timeoutMs ?? 60_000)
  for (let attempt = 0; ; attempt++) {
    try {
      return await completeOnce({ ...request, timeoutMs: Math.max(1_000, deadline - Date.now()) })
    } catch (error) {
      const wait = RETRY_DELAYS_MS[attempt]
      if (wait === undefined || !isBusy(error) || Date.now() + wait > deadline - 1_000) throw error
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

async function completeOnce(request: CompleteRequest): Promise<CompleteResult> {
  client ??= new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') })
  const model = requireEnv('GEMINI_MODEL')
  const response = await client.models.generateContent({
    model,
    contents: request.user,
    config: {
      systemInstruction: request.system,
      temperature: request.temperature ?? 0,
      abortSignal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
      ...(request.json ? { responseMimeType: 'application/json' } : {}),
      ...(request.json && request.jsonSchema ? { responseJsonSchema: request.jsonSchema } : {}),
      ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.thinkingLevel ? { thinkingConfig: { thinkingLevel: request.thinkingLevel as ThinkingLevel } } : {}),
      ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools }] } : {}),
    },
  })
  // Only the text parts: reading response.text on a function-call reply makes the SDK warn.
  const parts = response.candidates?.[0]?.content?.parts ?? []
  return {
    text: parts.flatMap((part) => (typeof part.text === 'string' && !part.thought ? [part.text] : [])).join(''),
    functionCalls: (response.functionCalls ?? []).map((call) => ({
      name: call.name ?? '',
      args: call.args ?? {},
    })),
    model,
    finishReason: response.candidates?.[0]?.finishReason,
    usage: {
      output: response.usageMetadata?.candidatesTokenCount ?? 0,
      thinking: response.usageMetadata?.thoughtsTokenCount ?? 0,
    },
  }
}
