import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { listBranches, listBrands } from './admin-api';

// The brands and branches the signed-in person may see, for filters and pickers. A person who
// cannot list brands but can see branches gets the branches of their own brand.
export function useDirectory() {
  const { user } = useAuth();
  const canListBrands = user?.permissions.includes('brands:read') ?? false;
  const canListBranches = user?.permissions.includes('branches:read') ?? false;

  const brands = useQuery({ queryKey: ['brands'], queryFn: listBrands, enabled: canListBrands });

  const brandIds = canListBrands
    ? (brands.data ?? []).map((brand) => brand.id)
    : user?.brandId
      ? [user.brandId]
      : [];

  const branches = useQueries({
    queries: brandIds.map((brandId) => ({
      queryKey: ['branches', brandId],
      queryFn: () => listBranches(brandId),
      enabled: canListBranches,
    })),
    combine: (results) => ({
      items: results.flatMap((result) => result.data ?? []),
      isLoading: results.some((result) => result.isLoading),
    }),
  });

  return {
    brands: brands.data ?? [],
    branches: branches.items,
    isLoading: brands.isLoading || branches.isLoading,
  };
}
