import { h, dialog, toast } from './dom.js';
import { receiptText } from '../receipt.js';

/** Show a receipt with Print and Share/Copy. Resolves when closed. */
export function showReceipt(ctx, sale, { closeLabel = 'Close' } = {}) {
  const text = receiptText(sale, ctx.settings);
  return dialog({
    title: 'Receipt',
    body: h('pre', { class: 'receipt' }, text),
    buttons: [
      {
        label: 'Print',
        onClick: () => {
          window.print();
          return false;
        },
      },
      {
        label: 'Share / copy',
        onClick: async () => {
          try {
            if (navigator.share) await navigator.share({ title: `Receipt ${sale.receiptNo}`, text });
            else {
              await navigator.clipboard.writeText(text);
              toast('Receipt copied.');
            }
          } catch {
            /* the person cancelled the share sheet */
          }
          return false;
        },
      },
      { label: closeLabel, kind: 'primary' },
    ],
  });
}
