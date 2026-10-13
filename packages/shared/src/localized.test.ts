import { describe, expect, it } from 'vitest';
import { localizedTextSchema } from './localized';

describe('localizedTextSchema', () => {
  it('needs both English and Arabic', () => {
    expect(localizedTextSchema.safeParse({ en: 'Pizza Palace', ar: 'بيتزا بالاس' }).success).toBe(
      true,
    );
    expect(localizedTextSchema.safeParse({ en: 'Pizza Palace' }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ en: 'Pizza Palace', ar: '' }).success).toBe(false);
  });
});
