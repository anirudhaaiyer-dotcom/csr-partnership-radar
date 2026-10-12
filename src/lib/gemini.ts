import { fetchRetry, QuotaError, SourceError, type FetchLike } from './http';

export interface JsonModel {
  name: string;
  generateJson(system: string, user: string, schema: unknown): Promise<unknown>;
}

/** Gemini Flash over the REST API. The model id comes from GEMINI_MODEL so it can change without a deploy. */
export function geminiModel(env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }, f: FetchLike = fetch): JsonModel | null {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const name = env.GEMINI_MODEL || 'gemini-flash-latest';
  return {
    name,
    async generateJson(system, user, schema) {
      const res = await fetchRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
          }),
          timeoutMs: 45000,
          retries: 1,
        },
        f,
      );
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        throw new QuotaError(Number.isFinite(ra) && ra > 0 ? ra : null, 'Gemini rate limit or daily quota reached');
      }
      if (!res.ok) throw new SourceError(`http_${res.status}`, `Gemini returned HTTP ${res.status}`);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      try {
        return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      } catch {
        throw new SourceError('parse', 'Gemini did not return valid JSON');
      }
    },
  };
}
