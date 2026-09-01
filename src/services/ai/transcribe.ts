// Voice capture without a dev build: record with expo-audio (works in Expo Go), send the clip to Gemini
// through the worker, get text back, then run the normal capture → enrich pipeline. Zero on-device STT needed.
// Native speech recognition (M5) can replace this later; the capture flow stays the same.

import { AiUnavailable, aiConfigured, callProxy } from './client';
import { extractJsonText } from './prompt';
import { detectLanguage } from '@/domain/enrich/heuristic';

const PROMPT = `Transkribiraj govor iz audio zapisa DOSLOVNO. Jezik je HRVATSKI (standardni, s dijakriticima: č ć ž š đ) — NIJE slovenski, srpski ni češki — osim ako je govor jasno engleski.
- Zapiši ono što je osoba htjela reći: ispravi očite greške izgovora u smislene riječi, dodaj dijakritike, interpunkciju i velika slova.
- Imena, brojeve i datume zapiši kako su izgovoreni ("deseti šesti" → "10.6.").
- Bez uvoda, bez komentara, bez navodnika — samo tekst bilješke u jednoj do dvije rečenice.
- Ako nema razumljivog govora, vrati prazan string.`;

export const MIME_CANDIDATES = ['audio/mp4', 'audio/aac', 'audio/m4a'] as const;

export function voiceAvailable(): boolean {
  return aiConfigured();
}

/**
 * base64 audio → text. Tries the MIME types Gemini accepts for an .m4a clip; a non-retryable
 * upstream rejection of one MIME falls through to the next.
 */
export async function transcribeAudio(base64: string, context = '', mime: string = MIME_CANDIDATES[0]): Promise<string> {
  const order = [mime, ...MIME_CANDIDATES.filter((m) => m !== mime)];
  let lastError: unknown = null;
  // `context` = the note text so far. Whisper uses it as its prompt (continuity + vocabulary); Gemini sees it in the
  // instructions so a second dictation is transcribed as a continuation, not a fresh sentence.
  const prompt = context.trim() ? `${PROMPT}\n\nOvo je NASTAVAK bilješke koja dosad glasi: „${context.trim().slice(-400)}”. Vrati samo novi dio.` : PROMPT;
  // Whisper auto-detection confuses Croatian with Slovenian/Serbian/Czech on short clips — always pin the language.
  // Croatian unless the note so far is clearly English.
  const language: 'hr' | 'en' = context.trim().length >= 12 ? detectLanguage(context) : 'hr';
  for (const mimeType of order) {
    const body = {
      language,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            // Instructions — read by Gemini, and deliberately NOT forwarded to Whisper: its `prompt` is a style
            // sample, not an instruction, so a block of directives ends up echoed into the transcript.
            { text: prompt },
            // The note so far. `voicePrompt` marks it as the one part Whisper may imitate (worker: groqWhisper).
            ...(context.trim() ? [{ text: context.trim().slice(-400), voicePrompt: true }] : []),
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
    };
    try {
      const resp = await callProxy<unknown>('transcribe', body, 45_000);
      const text = extractJsonText(resp).trim().replace(/^["„]|["“]$/g, '');
      // Non-speech audio makes the model emit filler like "00:00" or "…" — treat anything without letters as silence.
      return /[a-zA-ZčćžšđČĆŽŠĐ]{2,}/.test(text) ? text : '';
    } catch (e) {
      lastError = e;
      if (e instanceof AiUnavailable && e.retryable) throw e; // network — no point trying other MIMEs
      if (e instanceof Error && /empty model response/.test(e.message)) return '';
    }
  }
  throw lastError instanceof Error ? lastError : new AiUnavailable('transcription failed', false);
}
