/** Rótulo legível da cidade real do IP do proxy (lookup). */
export function formatProxyGeoLabel(
  city: string | null | undefined,
  region: string | null | undefined,
): string {
  const c = city?.trim() || "";
  const r = region?.trim() || "";
  if (c && r) return `${c}, ${r}`;
  return c || r || "—";
}
