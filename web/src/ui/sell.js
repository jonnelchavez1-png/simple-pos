// Sell screen: pick items, adjust quantity and discounts, take payment, show the receipt.

import { h, clear, dialog, confirmDialog, field, toast } from './dom.js';
import { priceCart } from '../pricing.js';
import { recordSale } from '../services.js';
import { uid } from '../util.js';
import { showReceipt } from './receiptDialog.js';

const describeDiscount = (d, ctx) => (d.type === 'percent' ? `${d.value}%` : ctx.fmt(d.value));

function suggestAmounts(total, unit) {
  const picks = new Set();
  for (const step of [1, 5, 10, 20, 50, 100, 500, 1000, 5000]) {
    const v = Math.ceil(total / (step * unit)) * step * unit;
    if (v > total) picks.add(v);
    if (picks.size >= 3) break;
  }
  return [...picks];
}

export async function renderSell(ctx, root) {
  const { settings, store, session } = ctx;
  const L = settings.labels;
  const cart = session.cart;
  const products = (await store.getAll('products')).filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();

  const search = h('input', {
    type: 'search',
    placeholder: `Search ${L.items.toLowerCase()}…`,
    value: session.search,
    oninput: (e) => {
      session.search = e.target.value;
      drawProducts();
    },
  });
  const chips = h('div', { class: 'chips' });
  const grid = h('div', { class: 'tiles' });
  const cartBox = h('div', { class: 'cart card' });
  const payBar = h('div', { class: 'paybar' });

  function drawChips() {
    clear(chips);
    if (categories.length < 2) return;
    for (const c of ['', ...categories]) {
      chips.append(
        h('button', { class: `chip ${session.category === c ? 'on' : ''}`, type: 'button', onclick: () => { session.category = c; drawChips(); drawProducts(); } }, c || 'All'),
      );
    }
  }

  function drawProducts() {
    clear(grid);
    const q = session.search.trim().toLowerCase();
    const list = products.filter((p) => (!session.category || p.category === session.category) && (!q || p.name.toLowerCase().includes(q)));
    if (!list.length) {
      grid.append(h('p', { class: 'muted' }, products.length ? `No ${L.items.toLowerCase()} match.` : `No ${L.items.toLowerCase()} yet. Add some in the ${L.items} tab, or use “Custom ${L.item.toLowerCase()}”.`));
      return;
    }
    for (const p of list) grid.append(h('button', { class: 'tile', type: 'button', onclick: () => addProduct(p) }, h('span', { class: 'tile-name' }, p.name), h('span', { class: 'tile-price' }, ctx.fmt(p.price))));
  }

  function addProduct(p) {
    const existing = cart.lines.find((l) => l.productId === p.id && !l.discount);
    if (existing) existing.qty = Math.round((existing.qty + 1) * 1000) / 1000;
    else cart.lines.push({ key: uid(), productId: p.id, name: p.name, unitPrice: p.price, qty: 1, taxId: p.taxId === 'none' ? null : p.taxId, discount: null });
    drawCart();
  }

  function setQty(line, qty) {
    const q = Math.round(qty * 1000) / 1000;
    if (!(q > 0)) cart.lines.splice(cart.lines.indexOf(line), 1);
    else line.qty = q;
    drawCart();
  }

  async function lineDiscountDialog(line) {
    const type = h('select', {}, h('option', { value: 'percent' }, '% off'), h('option', { value: 'fixed' }, `${settings.currency} off`));
    const value = h('input', { type: 'text', inputmode: 'decimal', value: line.discount ? (line.discount.type === 'percent' ? line.discount.value : ctx.input(line.discount.value)) : '' });
    if (line.discount) type.value = line.discount.type;
    await dialog({
      title: `Discount: ${line.name}`,
      body: h('div', { class: 'stack' }, field('Type', type), field('Amount', value)),
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Remove', onClick: () => { line.discount = null; drawCart(); } },
        {
          label: 'Apply',
          kind: 'primary',
          onClick: () => {
            const v = type.value === 'percent' ? Number(value.value.replace(',', '.')) : ctx.parse(value.value);
            if (!(v > 0)) throw new Error('Enter a discount amount.');
            if (type.value === 'percent' && v > 100) throw new Error('A percentage cannot be more than 100.');
            line.discount = { type: type.value, value: v };
            drawCart();
          },
        },
      ],
    });
  }

  async function orderDiscountDialog() {
    const type = h('select', {}, h('option', { value: 'percent' }, '% off'), h('option', { value: 'fixed' }, `${settings.currency} off`));
    const value = h('input', { type: 'text', inputmode: 'decimal' });
    await dialog({
      title: 'Discount on the whole order',
      body: h('div', { class: 'stack' }, field('Type', type), field('Amount', value)),
      buttons: [
        { label: 'Cancel', value: false },
        {
          label: 'Apply',
          kind: 'primary',
          onClick: () => {
            const v = type.value === 'percent' ? Number(value.value.replace(',', '.')) : ctx.parse(value.value);
            if (!(v > 0)) throw new Error('Enter a discount amount.');
            if (type.value === 'percent' && v > 100) throw new Error('A percentage cannot be more than 100.');
            cart.orderDiscount = { type: type.value, value: v };
            drawCart();
          },
        },
      ],
    });
  }

  async function customItemDialog() {
    const name = h('input', { type: 'text', maxlength: 80, placeholder: L.item });
    const price = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
    const qty = h('input', { type: 'text', inputmode: 'decimal', value: '1' });
    const tax = h('select', {}, settings.taxRates.map((t) => h('option', { value: t.id }, t.rate ? `${t.name} (${t.rate}%)` : t.name)));
    await dialog({
      title: `Custom ${L.item.toLowerCase()}`,
      body: h('div', { class: 'stack' }, field('Name', name), field('Price', price), field('Quantity', qty), field('Tax', tax)),
      buttons: [
        { label: 'Cancel', value: false },
        {
          label: 'Add to sale',
          kind: 'primary',
          onClick: () => {
            const p = ctx.parse(price.value);
            const q = Number(qty.value.replace(',', '.'));
            if (!name.value.trim()) throw new Error('Enter a name.');
            if (p == null || p < 0) throw new Error('Enter a price.');
            if (!(q > 0)) throw new Error('Enter a quantity.');
            cart.lines.push({ key: uid(), productId: null, name: name.value.trim(), unitPrice: p, qty: q, taxId: tax.value === 'none' ? null : tax.value, discount: null });
            drawCart();
          },
        },
      ],
    });
  }

  function lineRow(line, calc) {
    const qtyInput = h('input', {
      class: 'qty',
      type: 'text',
      inputmode: 'decimal',
      value: String(line.qty),
      'aria-label': `Quantity of ${line.name}`,
      onchange: (e) => {
        const n = Number(String(e.target.value).replace(',', '.'));
        if (Number.isFinite(n)) setQty(line, n);
        else e.target.value = String(line.qty);
      },
    });
    return h(
      'div',
      { class: 'cart-line' },
      h('div', { class: 'cl-main' }, h('strong', {}, line.name), h('span', { class: 'muted' }, `${ctx.fmt(line.unitPrice)} each${line.discount ? ` · ${describeDiscount(line.discount, ctx)} off` : ''}`)),
      h('div', { class: 'cl-qty' }, h('button', { class: 'btn small', type: 'button', onclick: () => setQty(line, line.qty - 1), 'aria-label': 'Less' }, '−'), qtyInput, h('button', { class: 'btn small', type: 'button', onclick: () => setQty(line, line.qty + 1), 'aria-label': 'More' }, '+')),
      h('div', { class: 'cl-total' }, ctx.fmt(calc.afterLine)),
      h('div', { class: 'cl-actions' }, h('button', { class: 'btn small', type: 'button', title: 'Discount', onclick: () => lineDiscountDialog(line) }, '%'), h('button', { class: 'btn small', type: 'button', title: 'Remove', onclick: () => setQty(line, 0) }, '✕')),
    );
  }

  function drawCart() {
    clear(cartBox);
    clear(payBar);
    if (!cart.lines.length) {
      cartBox.append(h('p', { class: 'muted empty' }, `Tap an ${L.item.toLowerCase()} to start a ${L.sale.toLowerCase()}.`));
      return;
    }
    let priced;
    try {
      priced = priceCart(cart, settings);
    } catch (err) {
      cartBox.append(h('p', { class: 'error' }, err.message));
      return;
    }
    priced.lines.forEach((calc, i) => cartBox.append(lineRow(cart.lines[i], calc)));

    // Order discount controls
    const dBox = h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Discount:'));
    for (const d of settings.discountPresets) {
      const on = cart.orderDiscount && cart.orderDiscount.type === d.type && cart.orderDiscount.value === d.value;
      dBox.append(h('button', { class: `chip ${on ? 'on' : ''}`, type: 'button', onclick: () => { cart.orderDiscount = on ? null : { type: d.type, value: d.value }; drawCart(); } }, d.label));
    }
    dBox.append(h('button', { class: 'chip', type: 'button', onclick: orderDiscountDialog }, 'Other…'));
    if (cart.orderDiscount && !settings.discountPresets.some((d) => d.type === cart.orderDiscount.type && d.value === cart.orderDiscount.value)) {
      dBox.append(h('button', { class: 'chip on', type: 'button', onclick: () => { cart.orderDiscount = null; drawCart(); } }, `${describeDiscount(cart.orderDiscount, ctx)} ✕`));
    }
    cartBox.append(dBox);

    // Totals
    const t = priced.totals;
    const tr = (label, value, cls = '') => h('div', { class: `trow ${cls}` }, h('span', {}, label), h('span', {}, value));
    const totals = h('div', { class: 'totals' }, tr('Subtotal', ctx.fmt(t.subtotal)));
    if (t.lineDiscounts > 0) totals.append(tr('Item discounts', `-${ctx.fmt(t.lineDiscounts)}`));
    if (t.orderDiscount > 0) totals.append(tr('Order discount', `-${ctx.fmt(t.orderDiscount)}`));
    for (const b of t.taxBreakdown.filter((x) => x.tax > 0)) totals.append(tr(`${settings.taxMode === 'inclusive' ? 'Includes ' : ''}${b.name} ${b.rate}%`, ctx.fmt(b.tax)));
    totals.append(tr('Total', ctx.fmt(t.total), 'grand'));
    cartBox.append(totals);

    payBar.append(
      h('button', { class: 'btn', type: 'button', onclick: async () => { if (await confirmDialog('Clear this sale?', 'Clear')) { cart.lines = []; cart.orderDiscount = null; drawCart(); } } }, 'Clear'),
      h('button', { class: 'btn primary big grow', type: 'button', onclick: () => charge(priced) }, `Charge ${ctx.fmt(t.total)}`),
    );
  }

  async function charge(priced) {
    const total = priced.totals.total;
    let method = settings.paymentMethods[0];
    const methodBox = h('div', { class: 'chips' });
    const received = h('input', { type: 'text', inputmode: 'decimal', placeholder: ctx.input(total) });
    const changeEl = h('strong', {}, '');
    const note = h('input', { type: 'text', maxlength: 200, placeholder: 'Optional note' });
    const cashBox = h('div', { class: 'stack' });

    const isCash = () => /cash/i.test(method);
    const updateChange = () => {
      const v = received.value.trim() ? ctx.parse(received.value) : null;
      changeEl.textContent = v == null ? '' : v >= total ? `Change: ${ctx.fmt(v - total)}` : `Short by ${ctx.fmt(total - v)}`;
    };
    received.addEventListener('input', updateChange);
    const drawMethods = () => {
      clear(methodBox);
      for (const m of settings.paymentMethods) methodBox.append(h('button', { class: `chip ${m === method ? 'on' : ''}`, type: 'button', onclick: () => { method = m; drawMethods(); } }, m));
      cashBox.hidden = !isCash();
    };
    const unit = 10 ** ctx.decimals;
    cashBox.append(
      field('Amount received', received),
      h('div', { class: 'chips' }, h('button', { class: 'chip', type: 'button', onclick: () => { received.value = ctx.input(total); updateChange(); } }, 'Exact'), suggestAmounts(total, unit).map((v) => h('button', { class: 'chip', type: 'button', onclick: () => { received.value = ctx.input(v); updateChange(); } }, ctx.fmt(v)))),
      changeEl,
    );
    drawMethods();

    const result = await dialog({
      title: `Charge ${ctx.fmt(total)}`,
      body: h('div', { class: 'stack' }, h('div', {}, h('div', { class: 'field-label' }, 'Payment method'), methodBox), cashBox, field('Note', note)),
      buttons: [
        { label: 'Cancel', value: false },
        {
          label: 'Complete sale',
          kind: 'primary',
          value: 'done',
          onClick: async () => {
            let tendered = null;
            if (isCash() && received.value.trim()) {
              tendered = ctx.parse(received.value);
              if (tendered == null) throw new Error('Enter the amount received as a number.');
            }
            const sale = await recordSale(store, settings, { cart, payment: { method, tendered }, note: note.value });
            cart.lines = [];
            cart.orderDiscount = null;
            ctx.lastSale = sale;
          },
        },
      ],
    });
    if (result !== 'done' || !ctx.lastSale) return;
    const sale = ctx.lastSale;
    ctx.lastSale = null;
    drawCart();
    ctx.afterChange();
    toast(`Sale ${sale.receiptNo} saved.`);
    await showReceipt(ctx, sale, { closeLabel: `New ${L.sale.toLowerCase()}` });
  }

  clear(root);
  root.append(
    h('div', { class: 'sell' },
      h('section', { class: 'sell-items' },
        h('div', { class: 'toolbar' }, search, h('button', { class: 'btn', type: 'button', onclick: customItemDialog }, `+ Custom`)),
        chips,
        grid,
      ),
      h('section', { class: 'sell-cart' }, h('h2', {}, `Current ${L.sale.toLowerCase()}`), cartBox, payBar),
    ),
  );
  drawChips();
  drawProducts();
  drawCart();
}
