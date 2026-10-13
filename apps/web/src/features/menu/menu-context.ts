import type { Branch, Brand } from '@pos/shared';
import { useOutletContext } from 'react-router';

// What the menu area gives to the screen inside it.
export interface MenuContext {
  brandId: string;
  brand: Brand | null;
  // The branches of this brand that the person may see.
  branches: Branch[];
  // Whether the person has menu:write. Without it the screens only show.
  canWrite: boolean;
}

export const useMenuContext = () => useOutletContext<MenuContext>();
