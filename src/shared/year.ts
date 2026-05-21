/** Pull a 4-digit year from values like "1988", "21 April 2021", or "April 21, 2021". */
export function normalizeYear(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}
