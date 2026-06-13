import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSystemPrompt } from './system-prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Guards the prompt-level fix for capture_decision over-eagerness (#4):
 * the agent must only record FINALIZED decisions, never an unresolved /
 * deferred debate. These assertions pin the negative-cue guidance in place
 * so a future edit can't silently loosen it back to "when a decision is made".
 */
describe('capture_decision over-eagerness guard', () => {
  it('system prompt (default path) warns against capturing deferred/unresolved discussion', async () => {
    // No orgId/userId → buildSystemPrompt uses DEFAULT_SYSTEM_PROMPT and skips
    // all DB-backed sections, so this runs without a database.
    const { prompt } = await buildSystemPrompt({});
    const lower = prompt.toLowerCase();

    // Capability line must carry the guard, not a generic "capture decisions".
    expect(lower).toContain('finalized');
    expect(lower).toContain('deferred');
    // A concrete negative cue from the finding ("revisit next sprint").
    expect(lower).toContain('revisit next sprint');
  });

  it('capture_decision TOOL DESCRIPTION includes finalized/agreed guard + negative cues', () => {
    const src = readFileSync(join(__dirname, 'tool-router.ts'), 'utf-8');

    // Locate the capture_decision tool block.
    const idx = src.indexOf("name: 'capture_decision'");
    expect(idx).toBeGreaterThan(-1);
    // Strip backslash escapes so source apostrophes (\') match plain text.
    const block = src.slice(idx, idx + 2000).toLowerCase().replace(/\\/g, '');

    // Positive cue + finalized framing.
    expect(block).toContain('finalized');
    expect(block).toContain("we've decided");
    expect(block).toContain('final call');

    // Negative cues that must mean DO NOT capture.
    for (const cue of ['maybe', 'we could', "let's revisit", 'revisit next sprint', "haven't decided", 'table it']) {
      expect(block).toContain(cue);
    }

    // The core anti-phantom rule.
    expect(block).toContain('deferred');
    expect(block).toContain('not a decision');
  });
});
