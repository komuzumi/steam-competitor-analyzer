export function extractAppId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{1,10}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/store\.steampowered\.com\/app\/(\d{1,10})(?:\/|$|\?)/);
  return match ? match[1] : null;
}
