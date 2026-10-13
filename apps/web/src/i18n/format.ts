// Dates and times follow the interface language. Arabic uses Western digits and the Gregorian
// calendar, to match the rest of the screens (the default Arabic calendar is Hijri).
export function formatDateTime(iso: string, language: string): string {
  const locale = language === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
