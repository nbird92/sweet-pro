// Render a Google Sheet template to a PDF Blob via the service-account endpoint
// (/api/render-template). The template is filled with `tokens` (scalar
// {{name}} replacements) and `lineItems` (one templated row per item).
export async function renderSheetTemplatePdf(params: {
  sheetId: string;
  tokens: Record<string, string>;
  lineItems?: Array<Record<string, string>>;
}): Promise<Blob> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const accessKey = (import.meta as any).env?.VITE_APP_ACCESS_KEY;
  if (accessKey) headers['x-access-key'] = accessKey;
  const res = await fetch('/api/render-template', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Template render failed (HTTP ${res.status}).`);
  }
  return await res.blob();
}
