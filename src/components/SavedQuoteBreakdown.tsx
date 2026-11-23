// Full price build-up of a saved quote — every contract element captured when
// the quote was saved (raw, ocean freight, yield, FX, margin, sugar loss, FCA
// base, supply chain, delivered freight, export duty, pallet charge, terms and
// the per-product differentials). Shown when a saved-quote row is expanded on
// the customer card or the sales lead.

import React from 'react';
import type { SavedQuote } from '../types';

const n2 = (v?: number) => (v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function SavedQuoteBreakdown({ q }: { q: SavedQuote }) {
  const cur = q.currency || 'CAD';
  const money = (v?: number) => (v == null ? '—' : `${cur} $${n2(v)}`);
  const items: Array<[string, React.ReactNode]> = [
    ['Raw sugar', q.rawPriceUsdCwt != null ? `USD ${n2(q.rawPriceUsdCwt)}/cwt${q.rawPriceUsdMt != null ? ` (USD $${n2(q.rawPriceUsdMt)}/MT)` : ''}` : '—'],
    ['Ocean freight', q.oceanFreightUsdMt != null ? `USD $${n2(q.oceanFreightUsdMt)}/MT` : '—'],
    ['Yield loss multiplier', q.yieldLossMultiplier != null ? `${q.yieldLossMultiplier}×` : '—'],
    ['FX (USD/CAD)', q.fxRate != null ? q.fxRate.toFixed(4) : '—'],
    ['Total cost of raws', q.totalCostOfRaws != null ? `${money(q.totalCostOfRaws)}/MT` : '—'],
    ['Refining margin', q.marginCadMt != null ? `CAD $${n2(q.marginCadMt)}/MT` : '—'],
    ['Sugar loss', q.sugarLossPct ? `${q.sugarLossPct}%` : '—'],
    [`FCA ${q.origin || ''} bulk`, q.fcaBulkMt != null ? `${money(q.fcaBulkMt)}/MT` : '—'],
    ['Supply chain', q.supplyChainCostMt ? `${money(q.supplyChainCostMt)}/MT` : '—'],
    ['Delivered freight', q.isDelivered ? `${money(q.deliveredFreight)}/MT${q.freightType ? ` · ${q.freightType}` : ''}${q.volumePerLoadMt ? ` · ${q.volumePerLoadMt} MT/load` : ''}` : 'FCA (none)'],
    ['Export duty', q.exportDuty ? `${money(q.exportDuty)}/MT` : '—'],
    ['Pallet charge', q.palletCharge ? `${money(q.palletCharge)}/MT${q.palletType ? ` · ${q.palletType}` : ''}` : (q.palletType ? `— · ${q.palletType}` : '—')],
    ['Shipping terms', q.shippingTerms || '—'],
    ['Payment terms', q.paymentTerms ? `${q.paymentTerms}${q.paymentTerms === '2% / Net 15' ? ' (+2%)' : ''}` : '—'],
    ['Final price', <b key="fp">{money(q.finalPriceMt)}/MT{q.perUnitPrice != null ? ` · ${money(q.perUnitPrice)}/unit` : ''}</b>],
    ['Volume / total', `${(q.volumeMt || 0).toLocaleString()} MT · ${money(q.totalValue)}`],
  ];
  return (
    <div className="bg-[#F9F9F8] border-t border-[#141414]/10 p-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
        {items.map(([k, v]) => (
          <div key={k}>
            <div className="text-[9px] uppercase tracking-widest font-bold opacity-50">{k}</div>
            <div className="text-[11px] font-mono">{v}</div>
          </div>
        ))}
      </div>
      {(q.productLines || []).length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest font-bold opacity-50 mb-1">Products &amp; differentials</div>
          <table className="text-[11px] border border-[#141414]/15">
            <thead><tr className="bg-white text-[9px] uppercase tracking-widest"><th className="px-2 py-1 text-left">Product</th><th className="px-2 py-1 text-right">Differential (CAD/MT)</th><th className="px-2 py-1 text-right">Price / MT</th><th className="px-2 py-1 text-right">Price / unit</th></tr></thead>
            <tbody>
              {(q.productLines || []).map((l, i) => (
                <tr key={i} className="border-t border-[#141414]/10">
                  <td className="px-2 py-1 font-bold">{l.product}</td>
                  <td className="px-2 py-1 text-right font-mono">{l.differentialCadMt ? `${l.differentialCadMt > 0 ? '+' : ''}${n2(l.differentialCadMt)}` : '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{money(l.finalPriceMt)}</td>
                  <td className="px-2 py-1 text-right font-mono">{l.perUnit != null ? money(l.perUnit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.rawPriceUsdMt == null && q.deliveredFreight == null && (
        <div className="text-[10px] italic opacity-50">Saved before the full breakdown was recorded — only the headline figures are available.</div>
      )}
    </div>
  );
}
