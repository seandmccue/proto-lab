/** Share-preview (Open Graph / Twitter card) tags for the single-page app's HTML.
 *  Scrapers want absolute image URLs, and a shared invention link should show that invention's title,
 *  description and preview picture rather than the generic site card. */
export interface OgInvention { id: string; title: string; description: string; previewUrl: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Origin for absolute URLs, honouring a reverse proxy's forwarded headers. */
export function originOf(headers: { get(name: string): string | null | undefined }, fallback: string): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return fallback;
  const proto = headers.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function rewriteOg(indexHtml: string, origin: string, inv: OgInvention | null): string {
  let html = indexHtml.replace(/content="\/og\.png"/g, `content="${origin}/og.png"`);
  if (!inv) return html;
  const title = esc(`${inv.title} — ProtoLab`);
  const description = esc(inv.description.trim() || 'An invention built and tested by Meta Muse in ProtoLab. Open it to replay the simulation and remix it.');
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`).replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`);
  if (inv.previewUrl) { const img = `${origin}${inv.previewUrl}`; html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`).replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`); }
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${origin}/i/${inv.id}$2`);
  return html;
}
