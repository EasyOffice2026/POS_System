import type { TFunction } from 'i18next';

// What a guest has to do in a group of modifiers: how many of them to choose.
export function describeChoices(
  group: { minSelect: number; maxSelect: number },
  t: TFunction,
): string {
  if (group.minSelect === 0) return t('menu.modifiers.rule.optional', { max: group.maxSelect });
  if (group.minSelect === group.maxSelect) {
    return t('menu.modifiers.rule.required', { min: group.minSelect });
  }
  return t('menu.modifiers.rule.requiredRange', { min: group.minSelect, max: group.maxSelect });
}
