import { isTimeZone } from '@pos/shared';
import { describe, expect, it } from 'vitest';
import { timeZoneGroups } from './time-zones';

describe('timeZoneGroups', () => {
  it('groups the zones by region, in order, with the zones that have no region last', () => {
    const groups = timeZoneGroups();

    const regions = groups.map((group) => group.region);
    expect(regions).toContain('Asia');
    expect(regions).toContain('Africa');
    expect(regions.at(-1)).toBe('Other');
    const named = regions.slice(0, -1);
    expect(named).toEqual([...named].sort());
    expect(groups.find((group) => group.region === 'Asia')?.names).toContain('Asia/Riyadh');
  });

  it('always offers the default zone and UTC', () => {
    const names = timeZoneGroups().flatMap((group) => group.names);

    expect(names).toContain('Asia/Riyadh');
    expect(names).toContain('UTC');
  });

  it('puts a zone with no region in a group of its own', () => {
    const other = timeZoneGroups().find((group) => group.region === 'Other');

    expect(other?.names).toContain('UTC');
  });

  it('adds the zone that is chosen when the browser does not list it', () => {
    expect(timeZoneGroups().flatMap((group) => group.names)).not.toContain('Zulu');

    const names = timeZoneGroups('Zulu').flatMap((group) => group.names);

    expect(names).toContain('Zulu');
  });

  it('lists each zone once, and every zone it lists is one the API accepts', () => {
    const names = timeZoneGroups('Asia/Kolkata').flatMap((group) => group.names);

    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !isTimeZone(name))).toEqual([]);
  });
});
