// Minimal Gemini API client for the renderer (the final video check). The key comes from the environment
// (renderer/.env, never Git). Text and inline images in, structured JSON out.
'use strict';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

class GeminiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** opts: { apiKey, model, fetchImpl, timeoutMs }. generateJson({ prompt, images: [{mimeType,data}], schema }) → object. */
function createGeminiClient({ apiKey, model, fetchImpl = fetch, timeoutMs = 120000 }) {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY가 없습니다 (renderer/.env).');
  return {
    model,
    async generateJson({ prompt, images = [], schema }) {
      const parts = [{ text: prompt }];
      images.forEach((im) => {
        if (im.label) parts.push({ text: im.label });
        parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } });
      });
      const body = { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(BASE + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (e) {
        throw new GeminiError('Gemini API에 연결하지 못했습니다: ' + e.message);
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      if (!res.ok) {
        let detail = text;
        try {
          detail = JSON.parse(text).error.message;
        } catch {}
        throw new GeminiError(`Gemini API 오류 (HTTP ${res.status}): ${String(detail).slice(0, 300)}`);
      }
      let out;
      try {
        const j = JSON.parse(text);
        const c = (j.candidates || [])[0];
        if (!c || !c.content || !c.content.parts || !c.content.parts[0]) throw new Error('빈 응답' + (c && c.finishReason ? ' (' + c.finishReason + ')' : ''));
        out = JSON.parse(c.content.parts.map((p) => p.text || '').join(''));
      } catch (e) {
        throw new GeminiError('Gemini 응답을 읽을 수 없습니다: ' + e.message);
      }
      return out;
    },
  };
}

module.exports = { createGeminiClient, GeminiError };
