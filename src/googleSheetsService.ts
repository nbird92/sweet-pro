import { auth, googleProvider } from './firebaseConfig';
import { signInWithPopup, getAdditionalUserInfo } from 'firebase/auth';
import type { Order, Customer, Carrier, Location, QAProduct } from './types';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

// Get a valid Google access token with Sheets scope
async function getAccessToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not signed in');

  // Try to get the token from the current session
  // If scopes weren't granted yet, re-authenticate with popup
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = (await import('firebase/auth')).GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      return credential.accessToken;
    }
  } catch (e: any) {
    console.error('Failed to get access token:', e);
  }

  throw new Error('Could not obtain Google access token. Please sign in again.');
}

// Cell mapping for the Order Confirmation template
// These map order data to specific cells in the Google Sheet
const CELL_MAP = {
  orderEntryDate: 'J7',
  customerPO: 'Y7',
  pickUpDate: 'J10',
  deliveryDate: 'Y10',
  consigneeName: 'F14',
  consigneeAddress: 'F15',
  consigneeEmail: 'F16',
  carrierName: 'V14',
  carrierTel: 'V15',
  carrierEmail: 'V16',
  deliverToName: 'F19',
  deliverToAddress: 'F20',
  deliverToAddress2: 'F21',
  shipperName: 'V19',
  shipperAddress: 'V20',
  bolNumber: 'Y38',
  // Line items start at row 25
  lineItemStartRow: 25,
  // Column positions for line items
  lineItemCols: {
    qtyMT: 'A',       // Qty (MT)
    qtyUnits: 'F',     // Qty (Units)
    description: 'Q',  // Description of Goods
    netWeight: 'W',    // Net Weight (Kg)
    grossWeight: 'AB',  // Gross Weight (Kg)
  },
};

interface GenerateOrderConfirmationParams {
  order: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipperLocation?: Location;
  qaProducts: QAProduct[];
  templateSpreadsheetId: string;
  templateSheetGid?: string;
}

export async function generateOrderConfirmation({
  order,
  customer,
  carrier,
  shipperLocation,
  qaProducts,
  templateSpreadsheetId,
}: GenerateOrderConfirmationParams): Promise<string> {
  const accessToken = await getAccessToken();

  // Step 1: Copy the template spreadsheet
  const copyResponse = await fetch(`${DRIVE_API_BASE}/${templateSpreadsheetId}/copy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `Order Confirmation - ${order.bolNumber} - ${order.customer}`,
    }),
  });

  if (!copyResponse.ok) {
    const err = await copyResponse.text();
    console.error('Drive copy failed:', err);
    throw new Error(`Failed to copy template: ${copyResponse.status}`);
  }

  const copiedFile = await copyResponse.json();
  const newSpreadsheetId = copiedFile.id;

  // Step 2: Build the cell value updates
  const sheetName = 'Order Confirmation';
  const valueRanges: { range: string; values: string[][] }[] = [];

  const addCell = (cell: string, value: string) => {
    valueRanges.push({
      range: `'${sheetName}'!${cell}`,
      values: [[value]],
    });
  };

  // Order header fields
  addCell(CELL_MAP.orderEntryDate, order.date || '');
  addCell(CELL_MAP.customerPO, order.po || '');
  addCell(CELL_MAP.pickUpDate, order.shipmentDate || '');
  addCell(CELL_MAP.deliveryDate, order.deliveryDate || '');
  addCell(CELL_MAP.bolNumber, order.bolNumber || '');

  // Consignee (customer)
  if (customer) {
    addCell(CELL_MAP.consigneeName, customer.name || '');
    const addressParts = [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean);
    addCell(CELL_MAP.consigneeAddress, addressParts.join(', '));
    addCell(CELL_MAP.consigneeEmail, customer.contactEmail || customer.salesContactEmail || '');
  } else {
    addCell(CELL_MAP.consigneeName, order.customer || '');
  }

  // Carrier
  if (carrier) {
    addCell(CELL_MAP.carrierName, carrier.name || '');
    addCell(CELL_MAP.carrierTel, carrier.contactPhone || '');
    addCell(CELL_MAP.carrierEmail, carrier.contactEmail || '');
  } else if (order.carrier) {
    addCell(CELL_MAP.carrierName, order.carrier);
  }

  // Deliver To (same as consignee for direct shipments)
  if (customer) {
    addCell(CELL_MAP.deliverToName, customer.name || '');
    addCell(CELL_MAP.deliverToAddress, customer.address || '');
    const cityProvPostal = [customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ');
    addCell(CELL_MAP.deliverToAddress2, cityProvPostal);
  }

  // Shipper (origin location)
  if (shipperLocation) {
    addCell(CELL_MAP.shipperName, shipperLocation.name || '');
    const shipperAddr = [shipperLocation.address, shipperLocation.city, shipperLocation.province, shipperLocation.postalCode].filter(Boolean).join(', ');
    addCell(CELL_MAP.shipperAddress, shipperAddr);
  } else if (order.location) {
    addCell(CELL_MAP.shipperName, order.location);
  }

  // Line items (rows 25-36, max 12 items)
  order.lineItems.forEach((item, index) => {
    if (index >= 12) return; // Max 12 line items in template
    const row = CELL_MAP.lineItemStartRow + index;
    const cols = CELL_MAP.lineItemCols;

    // Qty (MT) - total weight in MT
    addCell(`${cols.qtyMT}${row}`, item.totalWeight ? item.totalWeight.toFixed(2) : '');
    // Qty (Units)
    addCell(`${cols.qtyUnits}${row}`, item.qty ? item.qty.toString() : '');
    // Description of Goods
    addCell(`${cols.description}${row}`, item.productName || '');

    // Net Weight per unit from QA product data
    const qaProduct = qaProducts.find(p => p.skuName === item.productName);
    const netWeightKg = qaProduct?.netWeightKg || item.netWeightPerUnit || 0;
    const grossWeightKg = qaProduct?.grossWeightKg || 0;

    addCell(`${cols.netWeight}${row}`, netWeightKg ? (netWeightKg * item.qty).toFixed(2) : '');
    addCell(`${cols.grossWeight}${row}`, grossWeightKg ? (grossWeightKg * item.qty).toFixed(2) : '');
  });

  // Step 3: Batch update all cells
  const batchUpdateResponse = await fetch(
    `${SHEETS_API_BASE}/${newSpreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: valueRanges,
      }),
    }
  );

  if (!batchUpdateResponse.ok) {
    const err = await batchUpdateResponse.text();
    console.error('Sheets batch update failed:', err);
    throw new Error(`Failed to fill template: ${batchUpdateResponse.status}`);
  }

  // Return the URL of the new spreadsheet
  return `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`;
}

// Extract spreadsheet ID from a Google Sheets URL
export function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
