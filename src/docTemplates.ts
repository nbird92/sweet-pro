import type { Shipment, Order, Customer, Carrier, Location, ShipToLocation, QAProduct } from './types';
import type { TemplateGrid } from './templateGridPdf';
import { resolveLineWeights } from './pdfDocHelpers';

// ── Template registry ────────────────────────────────────────────────────────
// The app loads each QA template's grid once (on start / when the templates
// table changes) and registers it here. Every document renderer checks the
// registry and, when its template is loaded, draws the document FROM THE
// TEMPLATE (laid out like the sheet, instant). Otherwise it uses its built-in
// layout. A refresh therefore picks up any template edit.

export type DocTemplateKey =
  | 'bol' | 'coaLiquid' | 'coaGranulated' | 'packingList' | 'bagId'
  | 'scaleTicket' | 'orderConfirmation' | 'proForma';

const registry: Partial<Record<DocTemplateKey, { grid: TemplateGrid; logo: string }>> = {};

export function setDocTemplates(next: Partial<Record<DocTemplateKey, { grid: TemplateGrid; logo: string }>>): void {
  for (const k of Object.keys(registry) as DocTemplateKey[]) delete registry[k];
  Object.assign(registry, next);
}
export function docTemplate(key: DocTemplateKey): { grid: TemplateGrid; logo: string } | undefined {
  return registry[key];
}

// ── Shared token values ──────────────────────────────────────────────────────
const fmt2 = (n: number) => (n ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtUnits = (n: number) => (n ? String(Math.round(n * 100) / 100) : '');

/** Tokens every shipping document's template shares (BOL #, PO, dates, the
 *  consignee / carrier / deliver-to / shipper blocks, trailer, seals, origin). */
export function commonDocTokens(p: {
  shipment: Shipment; order?: Order; customer?: Customer; carrier?: Carrier;
  shipFromLocation?: Location; shipToLocation?: ShipToLocation;
  carrierName?: string; carrierEmail?: string;
}): Record<string, string> {
  const { shipment: s, order: o, customer: cu, carrier: ca, shipFromLocation: from, shipToLocation: to } = p;
  const deliverName = to?.name ? `${cu?.name || s.customer || ''} — ${to.name}` : (cu?.name || s.customer || '');
  const deliverAddress = to ? [to.addressLine1, to.addressLine2].filter(Boolean).join(', ') : (cu?.address || '');
  const deliverCityProv = to ? [to.city, to.province].filter(Boolean).join(', ') : [cu?.city, cu?.province].filter(Boolean).join(', ');
  const carrierName = p.carrierName || ca?.name || s.carrier || o?.carrier || '';
  const lots = (s.lotNumbers && s.lotNumbers.length ? s.lotNumbers : (s.lotNumber ? [s.lotNumber] : [])).join(', ');
  return {
    bol: s.bol || o?.bolNumber || '',
    bol_number: s.bol || o?.bolNumber || '',
    po: o?.po || s.po || '',
    pickup_date: s.date || o?.shipmentDate || '',
    delivery_date: s.deliveryDate || o?.deliveryDate || '',
    consignee_name: cu?.name || s.customer || '',
    consignee_address: cu ? [cu.address, cu.city, cu.province, cu.postalCode].filter(Boolean).join(', ') : '',
    consignee_tel: cu?.contactPhone || '',
    consignee_email: cu?.contactEmail || '',
    customer_corporate_address: cu ? [cu.address, cu.city, cu.province, cu.postalCode].filter(Boolean).join(', ') : '',
    carrier_name: carrierName,
    carrier: carrierName,
    carrier_tel: ca?.contactPhone || '',
    carrier_email: p.carrierEmail ?? (ca?.contactEmail || ''),
    deliver_name: deliverName,
    deliver_address: deliverAddress,
    deliver_city_province: deliverCityProv,
    deliver_postal: to?.postalCode || cu?.postalCode || '',
    shipper_name: from?.bolName || from?.name || o?.location || 'Sucro Can Canada',
    shipper_address: from?.address || '',
    shipper_city_province: from ? [from.city, from.province].filter(Boolean).join(', ') : '',
    shipper_postal: from?.postalCode || '',
    trailer_number: s.trailerNo || '',
    seal_number: (s.sealNumbers || []).filter(Boolean).join(', '),
    country_of_origin: s.originOfGoods || from?.name || o?.location || '',
    lot_code: lots,
  };
}

export interface GoodsLine { mt: number; units: number; description: string; contract: string; net: number; gross: number }

/** Goods lines as the BOL reports them: the shipment's Scaled Qty (MT) split
 *  across the order lines by ordered weight; net = MT x 1000, gross keeps the
 *  catalog gross/net ratio. (Mirrors the built-in BOL table.) */
export function computeGoods(shipment: Shipment, order: Order | undefined, qaProducts: QAProduct[]): { lines: GoodsLine[]; totalUnits: number; totalNet: number; totalGross: number } {
  const mtOf = (v: unknown): number => { const n = Number(v) || 0; return n >= 1000 ? n / 1000 : (n > 0 ? n : 0); };
  const scaledMt = mtOf(shipment.scaledQty);
  const lines: GoodsLine[] = [];
  if (order?.lineItems && order.lineItems.length) {
    const items = order.lineItems.map(li => ({ ...li, totalWeight: mtOf(li.totalWeight) }));
    const orderedMt = items.reduce((s, li) => s + li.totalWeight, 0);
    const ratio = scaledMt > 0 && orderedMt > 0 ? scaledMt / orderedMt : 1;
    for (const item of items) {
      const { netWt, grossWt } = resolveLineWeights(item, qaProducts);
      const lineMt = (item.totalWeight || 0) * ratio;
      const units = ratio !== 1 ? (netWt > 0 && lineMt > 0 ? (lineMt * 1000) / netWt : (item.qty || 0) * ratio) : (item.qty || 0);
      const net = lineMt > 0 ? lineMt * 1000 : netWt * units;
      const gross = lineMt > 0 ? (netWt > 0 && grossWt > 0 ? net * (grossWt / netWt) : net) : grossWt * units;
      lines.push({ mt: lineMt, units, description: item.productDisplayName || item.productName || '', contract: item.contractNumber || '', net, gross });
    }
  } else {
    const mt = scaledMt || mtOf(shipment.qty);
    lines.push({ mt, units: 0, description: order?.product || shipment.product || '', contract: shipment.contractNumber || '', net: scaledMt * 1000, gross: 0 });
  }
  return {
    lines,
    totalUnits: lines.reduce((s, l) => s + l.units, 0),
    totalNet: lines.reduce((s, l) => s + l.net, 0),
    totalGross: lines.reduce((s, l) => s + l.gross, 0),
  };
}

/** Item rows for a template's GOODS table from computed goods lines. */
export function goodsItems(g: ReturnType<typeof computeGoods>): Array<Record<string, string>> {
  return g.lines.map(l => ({
    description: l.description, contract: l.contract, units: fmtUnits(l.units),
    mt: l.mt ? l.mt.toFixed(2) : '', net: fmt2(l.net), gross: fmt2(l.gross),
  }));
}

export const goodsTotals = (g: ReturnType<typeof computeGoods>): Record<string, string> => ({
  total_units: fmtUnits(g.totalUnits), total_net: fmt2(g.totalNet), total_gross: fmt2(g.totalGross),
});
