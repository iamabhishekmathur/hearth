import { describe, it, expect } from 'vitest';

// Unit tests for share type filtering logic

type ShareType = 'full' | 'results_only' | 'template';

interface Message {
  role: string;
  content: string;
}

function filterMessages(messages: Message[], shareType: ShareType): Message[] {
  if (shareType === 'results_only') {
    return messages.filter((m) => m.role === 'assistant');
  }
  if (shareType === 'template') {
    return messages.filter((m) => m.role === 'user');
  }
  return messages; // full
}

const sampleMessages: Message[] = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there!' },
  { role: 'user', content: 'What is 2+2?' },
  { role: 'assistant', content: '4' },
  { role: 'system', content: 'System message' },
];

describe('Share type filtering', () => {
  it('full returns all messages', () => {
    const result = filterMessages(sampleMessages, 'full');
    expect(result).toHaveLength(5);
  });

  it('results_only returns only assistant messages', () => {
    const result = filterMessages(sampleMessages, 'results_only');
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role === 'assistant')).toBe(true);
  });

  it('template returns only user messages', () => {
    const result = filterMessages(sampleMessages, 'template');
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role === 'user')).toBe(true);
  });

  it('handles empty messages', () => {
    expect(filterMessages([], 'full')).toHaveLength(0);
    expect(filterMessages([], 'results_only')).toHaveLength(0);
    expect(filterMessages([], 'template')).toHaveLength(0);
  });
});
