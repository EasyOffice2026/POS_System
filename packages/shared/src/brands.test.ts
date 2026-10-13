import { describe, expect, it } from 'vitest';
import { closedWeek } from './branch-config';
import {
  branchDetailSchema,
  brandSchema,
  createBranchRequestSchema,
  createBrandRequestSchema,
  logoUrlSchema,
  updateBranchRequestSchema,
  updateBrandRequestSchema,
} from './brands';

function problems(result: { success: boolean; error?: { issues: unknown[] } }): string[] {
  const issues = (result.error?.issues ?? []) as { path: PropertyKey[]; message: string }[];
  return issues.map((issue) => `${issue.path.map(String).join('.')}:${issue.message}`);
}

const name = { en: 'Pizza Palace', ar: 'بيتزا بالاس' };

describe('createBrandRequestSchema', () => {
  it('accepts both names and gives the rest their defaults', () => {
    expect(createBrandRequestSchema.parse({ name })).toEqual({ name, isActive: true });
  });

  it('can start a brand as inactive and give a logo link', () => {
    const request = createBrandRequestSchema.parse({
      name,
      logoUrl: 'https://cdn.example.com/pizza.png',
      isActive: false,
    });

    expect(request).toMatchObject({
      logoUrl: 'https://cdn.example.com/pizza.png',
      isActive: false,
    });
  });

  it('refuses a name with only an English value, and says which one is missing', () => {
    const result = createBrandRequestSchema.safeParse({ name: { en: 'Pizza Palace' } });

    expect(problems(result)).toEqual(['name.ar:NAME_REQUIRED']);
  });

  it('refuses a missing name, and a blank value counts as missing', () => {
    expect(problems(createBrandRequestSchema.safeParse({}))).toEqual([
      'name:Invalid input: expected object, received undefined',
    ]);
    expect(problems(createBrandRequestSchema.safeParse({ name: { en: '   ', ar: '' } }))).toEqual([
      'name.en:NAME_REQUIRED',
      'name.ar:NAME_REQUIRED',
    ]);
  });

  it('trims the names and refuses a name that is too long', () => {
    expect(
      createBrandRequestSchema.parse({ name: { en: '  Pizza  ', ar: ' بيتزا ' } }).name,
    ).toEqual({
      en: 'Pizza',
      ar: 'بيتزا',
    });
    expect(
      problems(createBrandRequestSchema.safeParse({ name: { en: 'x'.repeat(101), ar: 'ب' } })),
    ).toEqual(['name.en:NAME_TOO_LONG']);
  });

  it('refuses a name that is not text, and a name with a third language', () => {
    expect(createBrandRequestSchema.safeParse({ name: { en: 1, ar: 'ب' } }).success).toBe(false);
    expect(createBrandRequestSchema.safeParse({ name: { ...name, fr: 'Palais' } }).success).toBe(
      false,
    );
  });

  it('refuses fields it does not know, such as an id or settings', () => {
    expect(
      createBrandRequestSchema.safeParse({ name, id: '01990000-0000-7000-8000-000000000001' })
        .success,
    ).toBe(false);
    expect(createBrandRequestSchema.safeParse({ name, settings: {} }).success).toBe(false);
  });
});

describe('logoUrlSchema', () => {
  it.each([
    'https://cdn.example.com/a.png',
    'http://localhost:9000/logo.svg',
    'https://x.io/a?b=1#c',
  ])('accepts %s', (url) => {
    expect(logoUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    '',
    'logo.png',
    '//cdn.example.com/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://example.com/a.png',
    'file:///etc/passwd',
    'https://user:secret@example.com/a.png',
    'https://x.io/' + 'a'.repeat(2048),
    'not a url',
  ])('refuses "%s"', (url) => {
    expect(problems(logoUrlSchema.safeParse(url))).toContain(':LOGO_URL_INVALID');
  });

  it('trims the link', () => {
    expect(logoUrlSchema.parse('  https://x.io/a.png  ')).toBe('https://x.io/a.png');
  });
});

describe('updateBrandRequestSchema', () => {
  it('accepts one change at a time', () => {
    expect(updateBrandRequestSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateBrandRequestSchema.safeParse({ name }).success).toBe(true);
    expect(updateBrandRequestSchema.safeParse({ logoUrl: null }).success).toBe(true);
  });

  it('refuses a request that changes nothing', () => {
    expect(problems(updateBrandRequestSchema.safeParse({}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('wants both names when a name is sent', () => {
    expect(problems(updateBrandRequestSchema.safeParse({ name: { en: 'Pizza' } }))).toEqual([
      'name.ar:NAME_REQUIRED',
    ]);
  });

  it('refuses fields it does not know', () => {
    expect(updateBrandRequestSchema.safeParse({ isActive: true, createdAt: 'x' }).success).toBe(
      false,
    );
  });
});

describe('createBranchRequestSchema', () => {
  it('accepts only the names, and defaults to the Kuwait time zone and active', () => {
    expect(createBranchRequestSchema.parse({ name })).toEqual({
      name,
      timezone: 'Asia/Kuwait',
      isActive: true,
    });
  });

  it('accepts the details and the configuration in one request', () => {
    const request = createBranchRequestSchema.parse({
      name,
      address: '  King Fahd Road, Riyadh ',
      timezone: 'Asia/Dubai',
      config: {
        openingHours: closedWeek(),
        printers: [{ name: 'Desk', kind: 'receipt', host: '10.0.0.2' }],
      },
    });

    expect(request.address).toBe('King Fahd Road, Riyadh');
    expect(request.timezone).toBe('Asia/Dubai');
    expect(request.config?.printers?.[0]).toMatchObject({ name: 'Desk', port: 9100 });
  });

  it('turns an empty address into none, and accepts none', () => {
    expect(createBranchRequestSchema.parse({ name, address: '  ' }).address).toBeNull();
    expect(createBranchRequestSchema.parse({ name, address: null }).address).toBeNull();
  });

  it('refuses an address that is too long', () => {
    expect(
      problems(createBranchRequestSchema.safeParse({ name, address: 'x'.repeat(301) })),
    ).toEqual(['address:ADDRESS_TOO_LONG']);
  });

  it.each(['Riyadh', '+03:00', 'Mars/Base', 'asia/riyadh', ''])(
    'refuses the time zone "%s"',
    (timezone) => {
      expect(problems(createBranchRequestSchema.safeParse({ name, timezone }))).toEqual([
        'timezone:TIMEZONE_INVALID',
      ]);
    },
  );

  it('refuses a brand id, because the brand comes from the address', () => {
    expect(
      createBranchRequestSchema.safeParse({ name, brandId: '01990000-0000-7000-8000-000000000001' })
        .success,
    ).toBe(false);
  });

  it('reports a problem in the configuration with its path', () => {
    const result = createBranchRequestSchema.safeParse({
      name,
      config: { printers: [{ name: 'Desk', kind: 'receipt', host: 'nope nope' }] },
    });

    expect(problems(result)).toEqual(['config.printers.0.host:PRINTER_HOST_INVALID']);
  });
});

describe('updateBranchRequestSchema', () => {
  it('accepts one change at a time', () => {
    expect(updateBranchRequestSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateBranchRequestSchema.safeParse({ address: null }).success).toBe(true);
    expect(updateBranchRequestSchema.safeParse({ config: { printers: [] } }).success).toBe(true);
  });

  it('refuses a request that changes nothing', () => {
    expect(problems(updateBranchRequestSchema.safeParse({}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('refuses to move a branch to another brand', () => {
    expect(
      updateBranchRequestSchema.safeParse({ brandId: '01990000-0000-7000-8000-000000000001' })
        .success,
    ).toBe(false);
  });
});

describe('what the API answers', () => {
  const brand = {
    id: '01990000-0000-7000-8000-000000000001',
    name,
    logoUrl: null,
    isActive: true,
    createdAt: '2026-10-09T08:00:00.000Z',
  };

  it('has the state of a brand', () => {
    expect(brandSchema.parse(brand).isActive).toBe(true);
    expect(brandSchema.safeParse({ ...brand, isActive: undefined }).success).toBe(false);
  });

  it('has the configuration with a single branch', () => {
    const branch = {
      id: '01990000-0000-7000-8000-000000000011',
      brandId: brand.id,
      name,
      address: null,
      timezone: 'Asia/Riyadh',
      isActive: true,
      config: { openingHours: closedWeek(), printers: [], dayEndsAt: '00:00' },
    };

    expect(branchDetailSchema.parse(branch).config.printers).toEqual([]);
  });
});
