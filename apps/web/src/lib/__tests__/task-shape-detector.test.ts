// @vitest-environment node
// (jsdom is configured in vitest.config.ts but not installed; these are pure functions.)
import { describe, it, expect } from 'vitest';
import { detectTaskShape, deriveTaskTitle } from '../task-shape-detector';

describe('detectTaskShape', () => {
  describe('non-matches (conservative by design)', () => {
    it('rejects empty content', () => {
      expect(detectTaskShape('').matches).toBe(false);
    });

    it('rejects short content (< 80 chars) even if it looks actionable', () => {
      expect(detectTaskShape("I'll draft it and then send it.").matches).toBe(false);
    });

    it('rejects plain prose with no plan shape', () => {
      const content =
        'The quarterly numbers look stable overall. Revenue grew modestly and churn ' +
        'remained flat across all customer segments during the period under analysis.';
      expect(detectTaskShape(content).matches).toBe(false);
    });

    it('rejects action verbs alone without a step list or plan announcement', () => {
      const content =
        "I'll draft something and then send it over when ready, let me know if you " +
        'want any changes to the wording here.';
      expect(detectTaskShape(content).matches).toBe(false);
    });

    it('rejects a step list with fewer than 3 items', () => {
      const content =
        'Two quick actions for you today:\n' +
        '1. Pull the report\n' +
        '2. Draft the email\n' +
        "That's all there is to it for now, nothing else needed from me.";
      expect(detectTaskShape(content).matches).toBe(false);
    });

    it('rejects bullet lines that do not start with a capitalized word', () => {
      const content =
        'Some loosely related notes about the rollout, listed for convenience:\n' +
        '- pull the data when convenient\n' +
        '- draft an email at some point\n' +
        '- send it whenever\n';
      // 3 bullets but STEP_LINE requires a capitalized leading word, and
      // there is no plan announcement.
      expect(detectTaskShape(content).matches).toBe(false);
    });
  });

  describe('matches', () => {
    it('detects a numbered step list with action-verb density', () => {
      const content =
        "Here's what I'd do for the weekly update:\n" +
        '1. Pull the latest usage metrics from the warehouse\n' +
        '2. Draft a summary email for the leadership team\n' +
        '3. Send it out and post to the #updates channel\n';
      const result = detectTaskShape(content);
      expect(result.matches).toBe(true);
      expect(result.reason).toBe('step-list+verbs');
    });

    it('detects bulleted (dash) step lists too', () => {
      const content =
        'To get this shipped before the deadline we should:\n' +
        '- First, fetch the open issues from the tracker\n' +
        '- Then, draft the changelog entry\n' +
        '- Finally, publish the release notes\n';
      const result = detectTaskShape(content);
      expect(result.matches).toBe(true);
      expect(result.reason).toBe('step-list+verbs');
    });

    it('detects an announced plan with verbs but no step list', () => {
      const content =
        "Here's the plan for the launch announcement. I'll draft the copy, then send " +
        'it to marketing for a quick look before we publish it on the blog Friday.';
      const result = detectTaskShape(content);
      expect(result.matches).toBe(true);
      expect(result.reason).toBe('announced-plan+verbs');
    });

    it('detects step list + announced plan even with low verb density', () => {
      const content =
        "Here's the plan:\n" +
        '1. Banana inventory audit across all regional locations\n' +
        '2. Orange supplier outreach via email this week\n' +
        '3. Apple cart maintenance window booking for Q3\n';
      const result = detectTaskShape(content);
      expect(result.matches).toBe(true);
      expect(result.reason).toBe('step-list+announced-plan');
    });

    it('matches "2)" style numbering', () => {
      const content =
        'Quick rundown of how to handle the incident report writeup:\n' +
        '1) Pull the alert timeline from the dashboard\n' +
        '2) Draft the incident summary document\n' +
        '3) Send it to the on-call channel for review\n';
      expect(detectTaskShape(content).matches).toBe(true);
    });
  });
});

describe('deriveTaskTitle', () => {
  it('uses the first numbered step as the title', () => {
    const content =
      'Some intro text first.\n' +
      '1. Pull the latest metrics from the warehouse\n' +
      '2. Draft the summary\n';
    expect(deriveTaskTitle(content)).toBe('Pull the latest metrics from the warehouse');
  });

  it('uses the first bulleted step as the title', () => {
    const content = 'Plan:\n- Draft the launch email\n- Send to the team\n';
    expect(deriveTaskTitle(content)).toBe('Draft the launch email');
  });

  it('truncates long steps to 77 chars plus an ellipsis', () => {
    const longStep = 'Assemble ' + 'x'.repeat(100);
    const title = deriveTaskTitle(`1. ${longStep}\n2. Done`);
    expect(title).toHaveLength(78);
    expect(title.endsWith('…')).toBe(true);
    expect(title.startsWith('Assemble ')).toBe(true);
  });

  it('falls back to the first sentence when there are no steps', () => {
    expect(deriveTaskTitle('Hello there team. More text follows here.')).toBe('Hello there team.');
  });

  it('collapses whitespace in the fallback sentence', () => {
    expect(deriveTaskTitle('This   has\nweird   spacing everywhere okay')).toBe(
      'This has weird spacing everywhere okay',
    );
  });

  it('truncates a long first sentence to 77 chars plus an ellipsis', () => {
    const title = deriveTaskTitle('word '.repeat(40).trim());
    expect(title).toHaveLength(78);
    expect(title.endsWith('…')).toBe(true);
  });
});
