import { describe, it, expect } from 'vitest';
import { regenerateOfFor } from '../regenerate';

describe('regenerateOfFor', () => {
  it('passes a persisted server id through', () => {
    expect(regenerateOfFor('2ac2389f-be88-465c-af45-1903f2c228a4')).toBe(
      '2ac2389f-be88-465c-af45-1903f2c228a4',
    );
  });

  it.each(['__streaming__', 'msg_1732400000000', 'user_1732400000000', '', null, undefined])(
    'drops a temporary or missing id (%j)',
    (id) => {
      expect(regenerateOfFor(id)).toBeUndefined();
    },
  );
});
