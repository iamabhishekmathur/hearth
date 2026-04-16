import { OpenAIProvider } from './openai-provider.js';

export interface OpenAICompatibleOptions {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
}

/**
 * Provider for OpenAI-compatible APIs (Groq, Together, Fireworks, etc.).
 * Extends the OpenAI provider with a custom base URL.
 */
export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(options: OpenAICompatibleOptions) {
    super({
      id: options.id,
      name: options.name,
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }
}

/**
 * Convenience factory for common OpenAI-compatible providers.
 */
export function createGroqProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'groq',
    name: 'Groq',
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

export function createTogetherProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'together',
    name: 'Together',
    apiKey,
    baseURL: 'https://api.together.xyz/v1',
  });
}

export function createFireworksProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'fireworks',
    name: 'Fireworks',
    apiKey,
    baseURL: 'https://api.fireworks.ai/inference/v1',
  });
}
