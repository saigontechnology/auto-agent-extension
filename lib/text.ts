export function collapseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
