// Business-type presets. This is the main place to adapt the app to a new kind of business:
// wording, payment methods, expense categories, quick discounts and a few sample items.
// Adding a business type = adding one entry below. No other file needs to change.

import { currencyDecimals } from './money.js';
import { uid } from './util.js';

const pay = ['Cash', 'Card', 'Bank transfer', 'E-wallet'];
const disc = [
  { label: '5%', type: 'percent', value: 5 },
  { label: '10%', type: 'percent', value: 10 },
  { label: '20%', type: 'percent', value: 20 },
];

export const PRESETS = {
  general: {
    label: 'General business',
    labels: { item: 'Item', items: 'Items', sale: 'Sale' },
    paymentMethods: pay,
    discountPresets: disc,
    expenseCategories: ['Stock / supplies', 'Rent', 'Utilities', 'Salaries & wages', 'Marketing', 'Transport', 'Equipment', 'Maintenance', 'Fees & permits', 'Other'],
    samples: [
      { name: 'Sample item A', price: 5, category: 'General' },
      { name: 'Sample item B', price: 12.5, category: 'General' },
    ],
  },
  retail: {
    label: 'Retail shop / store',
    labels: { item: 'Product', items: 'Products', sale: 'Sale' },
    paymentMethods: pay,
    discountPresets: [...disc, { label: '5 off', type: 'fixed', value: 5 }], // fixed values are in whole currency units here
    expenseCategories: ['Stock purchase', 'Rent', 'Utilities', 'Salaries & wages', 'Packaging', 'Shipping', 'Marketing', 'Equipment', 'Fees & permits', 'Other'],
    samples: [
      { name: 'T-shirt', price: 15, category: 'Clothing' },
      { name: 'Water bottle', price: 8, category: 'Accessories' },
      { name: 'Notebook', price: 3.5, category: 'Stationery' },
    ],
  },
  food: {
    label: 'Restaurant / cafe / food stall',
    labels: { item: 'Menu item', items: 'Menu', sale: 'Order' },
    paymentMethods: pay,
    discountPresets: [{ label: 'Staff 20%', type: 'percent', value: 20 }, ...disc.slice(0, 2)],
    expenseCategories: ['Ingredients', 'Packaging', 'Rent', 'Utilities', 'Salaries & wages', 'Delivery', 'Equipment', 'Marketing', 'Cleaning', 'Other'],
    samples: [
      { name: 'Coffee', price: 3, category: 'Drinks' },
      { name: 'Sandwich', price: 6.5, category: 'Food' },
      { name: 'Cake slice', price: 4.5, category: 'Dessert' },
    ],
  },
  services: {
    label: 'Services (salon, repair, clinic, freelance)',
    labels: { item: 'Service', items: 'Services', sale: 'Invoice' },
    paymentMethods: pay,
    discountPresets: disc.slice(0, 2),
    expenseCategories: ['Supplies', 'Software & subscriptions', 'Rent', 'Utilities', 'Salaries & contractors', 'Transport', 'Equipment', 'Marketing', 'Training', 'Other'],
    samples: [
      { name: 'Standard service', price: 25, category: 'Services' },
      { name: 'Premium service', price: 60, category: 'Services' },
    ],
  },
  wholesale: {
    label: 'Wholesale / distribution',
    labels: { item: 'Product', items: 'Products', sale: 'Order' },
    paymentMethods: ['Cash', 'Bank transfer', 'Cheque', 'Card'],
    discountPresets: [{ label: '3%', type: 'percent', value: 3 }, { label: '5%', type: 'percent', value: 5 }, { label: '10%', type: 'percent', value: 10 }],
    expenseCategories: ['Stock purchase', 'Freight', 'Warehouse rent', 'Utilities', 'Salaries & wages', 'Fuel', 'Equipment', 'Insurance', 'Fees & permits', 'Other'],
    samples: [
      { name: 'Carton (case of 24)', price: 48, category: 'Bulk' },
      { name: 'Pallet', price: 900, category: 'Bulk' },
    ],
  },
};

export const SCHEMA_VERSION = 1;

/** Starting settings for a new business. Everything here can be edited later in Settings. */
export function buildSettings({ businessName, businessType = 'general', currency = 'USD', taxRate = 0, taxMode = 'exclusive' }) {
  const p = PRESETS[businessType] ?? PRESETS.general;
  const rate = Number(taxRate) || 0;
  const unit = 10 ** currencyDecimals(String(currency || 'USD').toUpperCase());
  const taxRates = [{ id: 'none', name: 'No tax', rate: 0 }];
  if (rate > 0) taxRates.push({ id: 'std', name: 'Standard tax', rate });
  return {
    schemaVersion: SCHEMA_VERSION,
    businessName: String(businessName || 'My Business').trim(),
    businessType: PRESETS[businessType] ? businessType : 'general',
    currency: String(currency || 'USD').toUpperCase(),
    taxMode: taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
    taxRates,
    taxRegistered: rate > 0,
    paymentMethods: [...p.paymentMethods],
    expenseCategories: [...p.expenseCategories],
    // Stored with fixed amounts in the smallest currency unit, like every other amount.
    discountPresets: p.discountPresets.map((d) => ({ ...d, value: d.type === 'fixed' ? Math.round(d.value * unit) : d.value })),
    labels: { ...p.labels },
    receipt: { header: '', footer: 'Thank you!', prefix: 'R' },
    sync: { url: '', token: '', lastPush: null, lastPull: null },
  };
}

export function sampleProducts(businessType, currency, taxEnabled) {
  const p = PRESETS[businessType] ?? PRESETS.general;
  const decimals = currencyDecimals(currency);
  return p.samples.map((s) => ({
    id: uid(),
    name: s.name,
    price: Math.round(s.price * 10 ** decimals),
    category: s.category,
    taxId: taxEnabled ? 'std' : 'none',
    active: true,
  }));
}
