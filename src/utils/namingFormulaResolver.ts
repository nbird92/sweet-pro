import type { NamingFormula, FormulaToken, SugarType, ProductGroup } from '../types';

// Generic shape of any product-like object that can be evaluated against a formula
export interface NameableProduct {
  productFormat?: string;
  productGroup?: string;
  category?: string;            // 'Conventional' | 'Organic'
  sugarType?: string;
  location?: string;
  netWeightKg?: number;
  grossWeightKg?: number;
  maxColor?: number;
  name?: string;
  skuName?: string;
}

export interface NamingContext {
  sugarTypes: SugarType[];
  productGroups: ProductGroup[];
}

// Map condition field labels (as shown in UI / stored in `condition`) to product keys.
const CONDITION_FIELD_TO_KEY: Record<string, keyof NameableProduct> = {
  'product group': 'productGroup',
  'packaging format': 'productFormat',
  'product format': 'productFormat',
  'sugar type': 'sugarType',
  'conv./organic': 'category',
  'category': 'category',
  'location': 'location',
  'max color': 'maxColor',
  'net weight (kg)': 'netWeightKg',
  'gross weight (kg)': 'grossWeightKg',
};

// Check if a product matches a rule's condition string (e.g. "Product Group = Bulk").
// "Default" or empty always matches.
export function matchesCondition(condition: string | undefined, product: NameableProduct): boolean {
  if (!condition) return true;
  const trimmed = condition.trim();
  if (!trimmed || trimmed.toLowerCase() === 'default') return true;

  // Support multiple comma-separated AND conditions, e.g. "Product Group = Bulk, Sugar Type = Granulated"
  const parts = trimmed.split(',').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*=\s*(.+)$/);
    if (!m) return false;
    const fieldLabel = m[1].trim().toLowerCase();
    const expected = m[2].trim();
    const key = CONDITION_FIELD_TO_KEY[fieldLabel];
    if (!key) return false;
    const actual = (product as any)[key];
    // Compare loosely as strings to handle numbers / undefined
    if (actual === undefined || actual === null) return false;
    if (String(actual).trim().toLowerCase() !== expected.toLowerCase()) return false;
  }
  return true;
}

// Resolve a single token to its rendered string for a given product.
export function resolveToken(token: FormulaToken, product: NameableProduct, ctx: NamingContext): string {
  if (token.type === 'literal') return token.value;
  if (token.type === 'productGroup') return token.value;
  if (token.type === 'productGroupCode') return token.value;
  if (token.type === 'sugarType') return token.value;
  if (token.type === 'sugarTypeAbbr') return token.value;

  if (token.type === 'field') {
    switch (token.value) {
      case 'netWeightKg':
        return product.netWeightKg !== undefined && product.netWeightKg !== null ? String(product.netWeightKg) : '';
      case 'grossWeightKg':
        return product.grossWeightKg !== undefined && product.grossWeightKg !== null ? String(product.grossWeightKg) : '';
      case 'productFormat':
        return product.productFormat || '';
      case 'productGroup':
        return product.productGroup || '';
      case 'category':
        return product.category || '';
      case 'sugarType':
        return product.sugarType || '';
      case 'location':
        return product.location || '';
      case 'maxColor':
        return product.maxColor !== undefined && product.maxColor !== null ? String(product.maxColor) : '';
      case 'coChar':
        return product.category === 'Conventional' ? 'C' : product.category === 'Organic' ? 'B' : '';
      case 'sugarTypeAbbreviation': {
        const st = ctx.sugarTypes.find(s => s.name === product.sugarType);
        return st?.abbreviation || '';
      }
      case 'productGroupBolCode': {
        const pg = ctx.productGroups.find(g => g.name === product.productGroup);
        return pg?.bolCode || '';
      }
      default:
        return '';
    }
  }
  return '';
}

export function evaluateTokens(tokens: FormulaToken[] | undefined, product: NameableProduct, ctx: NamingContext): string {
  if (!tokens || tokens.length === 0) return '';
  return tokens.map(t => resolveToken(t, product, ctx)).join('');
}

// Pick the best-matching rule of a given type. Specific (non-Default) rules with the
// lowest priority number win; Default rules act as a last-resort fallback.
export function pickMatchingRule(
  formulas: NamingFormula[],
  type: NamingFormula['type'],
  product: NameableProduct,
): NamingFormula | null {
  const candidates = formulas
    .filter(nf => nf.type === type)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  // 1) Try non-Default rules in priority order
  for (const rule of candidates) {
    const cond = (rule.condition || '').trim().toLowerCase();
    if (cond && cond !== 'default' && matchesCondition(rule.condition, product)) {
      return rule;
    }
  }

  // 2) Fall back to a Default rule
  const defaultRule = candidates.find(r => !r.condition || r.condition.trim().toLowerCase() === 'default');
  return defaultRule || null;
}

// Resolve a product's Product Name string using the user-defined rules.
// Returns null when no rule could be evaluated (caller decides the fallback).
export function resolveProductName(
  formulas: NamingFormula[],
  product: NameableProduct,
  ctx: NamingContext,
): string | null {
  const rule = pickMatchingRule(formulas, 'Product Name', product);
  if (!rule) return null;
  return evaluateTokens(rule.tokens, product, ctx);
}

// Resolve a product's Short Form string using the user-defined rules.
export function resolveShortForm(
  formulas: NamingFormula[],
  product: NameableProduct,
  ctx: NamingContext,
): string | null {
  const rule = pickMatchingRule(formulas, 'Short Form', product);
  if (!rule) return null;
  return evaluateTokens(rule.tokens, product, ctx);
}
