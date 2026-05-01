// Deterministic per-user color palette for message attribution.
// Pick from a curated 8-color set so consecutive users are visually distinct
// against both light and dark surfaces.
const PALETTE = [
  { fill: '#E76F51', text: '#FFFFFF' }, // terracotta
  { fill: '#2A9D8F', text: '#FFFFFF' }, // teal
  { fill: '#264653', text: '#FFFFFF' }, // deep slate
  { fill: '#8E44AD', text: '#FFFFFF' }, // violet
  { fill: '#3D5A80', text: '#FFFFFF' }, // navy
  { fill: '#B5651D', text: '#FFFFFF' }, // umber
  { fill: '#1B998B', text: '#FFFFFF' }, // jade
  { fill: '#6A4C93', text: '#FFFFFF' }, // plum
] as const;

function hashUserId(userId: string): number {
  let h = 5381;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) + h) ^ userId.charCodeAt(i);
  }
  return Math.abs(h);
}

export function authorColor(userId: string): { fill: string; text: string } {
  return PALETTE[hashUserId(userId) % PALETTE.length];
}

export function authorInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
