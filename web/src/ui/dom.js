// Tiny DOM helpers. Text is always inserted as text (never as HTML), which keeps the app safe
// from injected markup in product names, notes and imported receipts.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k !== 'list' && k !== 'form' && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function toast(message, kind = '') {
  const host = document.getElementById('toast');
  const item = h('div', { class: `toast ${kind}` }, message);
  host.append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 6000 : 3000);
}

/**
 * Modal dialog. Each button may have onClick(dialogEl); return false to keep the dialog open.
 * Resolves with the clicked button's `value` (or label), or null if dismissed.
 */
export function dialog({ title, body, buttons = [{ label: 'Close' }], wide = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: wide ? 'wide' : '' });
    const finish = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    const buttonEls = buttons.map((b) =>
      h(
        'button',
        {
          class: `btn ${b.kind || ''}`,
          type: 'button',
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            if (b.onClick) {
              btn.disabled = true;
              try {
                if ((await b.onClick(dlg)) === false) {
                  btn.disabled = false;
                  return;
                }
              } catch (err) {
                toast(err.message || String(err), 'error');
                btn.disabled = false;
                return;
              }
            }
            finish(b.value ?? b.label);
          },
        },
        b.label,
      ),
    );
    dlg.append(h('h2', {}, title), h('div', { class: 'dialog-body' }, body), h('div', { class: 'dialog-actions no-print' }, buttonEls));
    dlg.addEventListener('cancel', () => {
      dlg.remove();
      resolve(null);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export const confirmDialog = (message, okLabel = 'Yes', kind = 'danger') =>
  dialog({
    title: 'Please confirm',
    body: h('p', {}, message),
    buttons: [{ label: 'Cancel', value: false }, { label: okLabel, kind, value: true }],
  }).then((v) => v === true);

/** A labelled form field. */
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
}

export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsText(file);
  });
}
