// A number typed on an Arabic keyboard has Arabic-Indic digits (٠-٩, or ۰-۹ on a Persian keyboard)
// and the Arabic decimal mark (٫). The rules for prices expect plain digits and a point, so what
// is typed is changed to that before it is kept. Anything else is left as it is, so a wrong
// value is still reported by the rules.
export function normalizeNumberInput(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}
