import { GoogleGenAI, ApiError, ThinkingLevel } from "@google/genai";

/* Someone is waiting on a button, so give up after this long in total. */
const TIMEOUT_MS = 50_000;
/* Tried in order. When Google reports a model as overloaded, the next one is used. */
const MODELS = [
  process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
  ...(process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.5-flash").split(",").map((m) => m.trim()),
].filter((m, i, a) => m && a.indexOf(m) === i);

type Result = { text?: string; error?: string };

/* Google is busy or the model is briefly unavailable: worth trying the next model. */
function overloaded(e: unknown) {
  return e instanceof ApiError && (e.status === 503 || e.status === 500 || e.status === 429 || e.status === 404);
}

export async function askGemini(system: string, user: string): Promise<Result> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { error: "Gemini API key is not set. Add GEMINI_API_KEY to .env.local." };

  const ai = new GoogleGenAI({ apiKey });
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let last: unknown;

  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          // Short writing tasks: little reasoning needed, and it keeps the wait short.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: signal,
        },
      });
      const text = response.text?.trim();
      return text ? { text } : { error: "The AI returned nothing. Try again." };
    } catch (e) {
      last = e;
      if (overloaded(e) && !signal.aborted) {
        console.warn(`[gemini] ${model} unavailable (${(e as ApiError).status}), trying the next model`);
        continue;
      }
      break;
    }
  }
  return explain(last);
}

function explain(e: unknown): Result {
  if (e instanceof ApiError) {
    const msg = e.message.toLowerCase();
    if (e.status === 401 || e.status === 403 || msg.includes("api key") || msg.includes("api_key"))
      return { error: "The Gemini API key was rejected. Check GEMINI_API_KEY." };
    if (e.status === 429 || e.status === 503 || e.status === 500 || msg.includes("resource_exhausted"))
      return { error: "Gemini is very busy right now. Try again in a minute." };
    console.error("[gemini]", e.status, e.message.slice(0, 300));
    return { error: `The AI request failed (status ${e.status}).` };
  }
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return { error: "The AI took too long to answer. Try again." };
    const msg = e.message.toLowerCase();
    if (e instanceof TypeError || /fetch failed|network|enotfound|econnrefused|econnreset/.test(msg))
      return { error: "Could not reach the Gemini API. Check your connection." };
    console.error("[gemini]", e.message.slice(0, 300));
  }
  return { error: "The AI request failed. Try again." };
}
