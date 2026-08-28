// Thin client for the Cloudflare Worker proxy. The Gemini key lives ONLY in the worker.
// EXPO_PUBLIC_AI_PROXY_URL is safe to ship — it's just a URL. No URL → offline/heuristic mode.

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { newId } from '@/lib/ids';

export type Endpoint = 'enrich' | 'embed' | 'edit' | 'transcribe';

export const AI_PROXY_URL: string | null = process.env.EXPO_PUBLIC_AI_PROXY_URL?.replace(/\/$/, '') || null;

export class AiUnavailable extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

let deviceIdCache: string | null = null;

export async function deviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  let id: string | null = null;
  try {
    id = Platform.OS === 'android' ? Application.getAndroidId() : await Application.getIosIdForVendorAsync();
  } catch {
    id = null;
  }
  deviceIdCache = id || `anon_${newId()}`;
  return deviceIdCache;
}

export function aiConfigured(): boolean {
  return AI_PROXY_URL != null;
}

export async function callProxy<T>(endpoint: Endpoint, body: unknown, timeoutMs = 12_000): Promise<T> {
  if (!AI_PROXY_URL) throw new AiUnavailable('AI proxy not configured', false);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_PROXY_URL}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': await deviceId() },
      body: JSON.stringify({ endpoint, body }),
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new AiUnavailable('rate limited', true);
    if (res.status >= 500) throw new AiUnavailable(`upstream ${res.status}`, true);
    if (!res.ok) throw new AiUnavailable(`proxy ${res.status}: ${await res.text()}`, false);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof AiUnavailable) throw e;
    // network error / abort → retryable
    throw new AiUnavailable(e instanceof Error ? e.message : 'network', true);
  } finally {
    clearTimeout(timer);
  }
}
