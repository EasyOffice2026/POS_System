import type { Branch, Brand } from '@pos/shared';
import { useSearchParams } from 'react-router';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';

export interface MenuBrand {
  // The brand whose menu is on the screen. It is null until the brands are loaded, and when there
  // is no brand at all.
  brandId: string | null;
  // The brand itself, for its name. A person who cannot list brands does not get it.
  brand: Brand | null;
  // The brands the person may choose from.
  brands: Brand[];
  // The branches of this brand that the person may see.
  branches: Branch[];
  isLoading: boolean;
  isError: boolean;
}

// The menu belongs to a brand. A person who belongs to a brand works on that brand's menu. A group
// admin chooses one, and the choice is in the address (?brandId=), so a link, a reload or the back
// button keep it. Without a valid choice they get the first brand.
export function useMenuBrand(): MenuBrand {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const directory = useDirectory();

  const requested = searchParams.get('brandId');
  const chosen =
    directory.brands.find((brand) => brand.id === requested)?.id ?? directory.brands[0]?.id ?? null;
  const brandId = user?.brandId ?? chosen;

  return {
    brandId,
    brand: directory.brands.find((brand) => brand.id === brandId) ?? null,
    brands: directory.brands,
    branches: directory.branches.filter((branch) => branch.brandId === brandId),
    isLoading: directory.isLoading,
    isError: directory.isError,
  };
}
