import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDoc, getSheet, checkAuth, checkGoogleConfig } from './_sheets.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!checkAuth(req.headers['x-access-key'])) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }

  const config = checkGoogleConfig();
  if (!config.hasId || !config.hasEmail || !config.hasKey) {
    return res.json({ configMissing: true, details: config });
  }

  try {
    const doc = getDoc();
    await doc.loadInfo();

    const customerSheet = await getSheet(doc, 'Customers', true);
    const productSheet = await getSheet(doc, 'Products', true);
    const supplySheet = await getSheet(doc, 'Logistics', true);
    const freightSheet = await getSheet(doc, 'FreightRates', true);
    const contractSheet = await getSheet(doc, 'Contracts', true);
    const carrierSheet = await getSheet(doc, 'Carriers', true);
    const shipmentSheet = await getSheet(doc, 'Shipments', true);
    const locationSheet = await getSheet(doc, 'Locations', true);
    const transferSheet = await getSheet(doc, 'Transfers', true);
    const invoiceSheet = await getSheet(doc, 'Invoices', true);
    const productGroupSheet = await getSheet(doc, 'ProductGroups', true);
    const orderSheet = await getSheet(doc, 'Orders', true);

    const customers = customerSheet ? await customerSheet.getRows() : [];
    const products = productSheet ? await productSheet.getRows() : [];
    const logistics = supplySheet ? await supplySheet.getRows() : [];
    const freightRates = freightSheet ? await freightSheet.getRows() : [];
    const contracts = contractSheet ? await contractSheet.getRows() : [];
    const carriers = carrierSheet ? await carrierSheet.getRows() : [];
    const shipments = shipmentSheet ? await shipmentSheet.getRows() : [];
    const locations = locationSheet ? await locationSheet.getRows() : [];
    const transfers = transferSheet ? await transferSheet.getRows() : [];
    const invoicesData = invoiceSheet ? await invoiceSheet.getRows() : [];
    const productGroups = productGroupSheet ? await productGroupSheet.getRows() : [];
    const ordersData = orderSheet ? await orderSheet.getRows() : [];

    res.json({
      customers: customers.map(r => r.toObject()),
      products: products.map(r => r.toObject()),
      logistics: logistics.map(r => r.toObject()),
      freightRates: freightRates.map(r => r.toObject()),
      contracts: contracts.map(r => r.toObject()),
      carriers: carriers.map(r => r.toObject()),
      shipments: shipments.map(r => r.toObject()),
      locations: locations.map(r => r.toObject()),
      transfers: transfers.map(r => r.toObject()),
      invoices: invoicesData.map(r => r.toObject()),
      productGroups: productGroups.map(r => r.toObject()),
      orders: ordersData.map(r => r.toObject()),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}
