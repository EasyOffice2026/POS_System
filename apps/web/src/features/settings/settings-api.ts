import { type BrandSettings, type BrandSettingsRequest, brandSettingsSchema } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../lib/api';

export const settingsKeys = {
  brand: (brandId: string) => ['settings', brandId] as const,
};

export const getBrandSettings = (brandId: string) =>
  request(`/brands/${brandId}/settings`, { schema: brandSettingsSchema });

export const updateBrandSettings = (brandId: string, body: BrandSettingsRequest) =>
  request(`/brands/${brandId}/settings`, { method: 'PUT', body, schema: brandSettingsSchema });

// The settings of a brand, as the terminals and the admin screens need them. A terminal asks
// again every few minutes, so a change reaches it without a restart (spec 009, rule 8).
export function useBrandSettings(brandId: string | null, refetchMs?: number) {
  return useQuery({
    queryKey: settingsKeys.brand(brandId ?? ''),
    queryFn: () => getBrandSettings(brandId ?? ''),
    enabled: Boolean(brandId),
    ...(refetchMs ? { refetchInterval: refetchMs } : {}),
  });
}

export type { BrandSettings };
