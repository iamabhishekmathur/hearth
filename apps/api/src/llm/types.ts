import type { ChatParams, ChatEvent } from '@hearth/shared';

export interface LLMProvider {
  id: string;
  name: string;
  chat(params: ChatParams): AsyncIterable<ChatEvent>;
  embed?(texts: string[]): Promise<number[][]>;
  listModels(): Promise<string[]>;
}
