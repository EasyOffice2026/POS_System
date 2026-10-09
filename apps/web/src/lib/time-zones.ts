import { DEFAULT_TIMEZONE } from '@pos/shared';

export interface TimeZoneGroup {
  region: string;
  names: string[];
}

// The time zones to choose from: the ones this browser knows, grouped by region (Africa, Asia and
// so on). A zone that is already chosen is added when the browser does not list it, because the
// API accepts more names than a browser lists, so a choice never shows as blank.
export function timeZoneGroups(current?: string): TimeZoneGroup[] {
  const names = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC', DEFAULT_TIMEZONE]);
  if (current) names.add(current);

  const regions = new Map<string, string[]>();
  for (const name of [...names].sort()) {
    const region = name.includes('/') ? name.slice(0, name.indexOf('/')) : 'Other';
    regions.set(region, [...(regions.get(region) ?? []), name]);
  }
  return [...regions].map(([region, list]) => ({ region, names: list }));
}
