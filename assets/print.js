const { createApp, ref, computed, nextTick } = Vue;

createApp({
    setup() {
        // Start with an empty items array so the v-for has something to bind to
        // before the invoice arrives from the main process.
        const invoice = ref({ items: [] });

        // "as of" stamp under the balance, same format as the Angular PDF:
        // "30 September 2026, 14:05". Date and time are formatted apart because a
        // combined toLocaleString reads "… at 14:05" on newer ICU.
        const formatStamp = (date) =>
            date.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
            }) +
            ", " +
            date.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            });

        // Same currency formatter used by the other print templates.
        const currency = (value, symbol = "$", decimals = 2) => {
            if (value === undefined || value === null || value === "") return "";
            return (
                symbol +
                Number(value)
                    .toFixed(decimals)
                    .replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,")
            );
        };

        // ── Sales vs return vs delivery (mirrors PdfService.exportInvoicePDF) ──
        const isDelivery = computed(() => invoice.value.type === "delivery");
        // A return prints like a sale (same balance block) under its own title.
        const isReturn = computed(() => invoice.value.type === "return");
        const docTitle = computed(() =>
            isDelivery.value ? "DELIVERY" : isReturn.value ? "RETURN" : "INVOICE"
        );
        const recipientLabel = computed(() =>
            isDelivery.value ? "DELIVER TO" : "BILL TO"
        );
        const recipientName = computed(() =>
            isDelivery.value
                ? [invoice.value.first_name, invoice.value.last_name]
                      .filter(Boolean)
                      .join(" ") || "—"
                : invoice.value.customer_name || "—"
        );
        const dateValue = computed(() =>
            isDelivery.value
                ? invoice.value.order_datetime
                : invoice.value.order_date
        );
        const grandTotal = computed(() =>
            isDelivery.value
                ? invoice.value.total_price ?? invoice.value.total_amount
                : invoice.value.total_amount
        );
        // Delivery items have no per-line total → derive it.
        const lineTotal = (item) =>
            item.total_price ?? item.quantity * (item.unit_price || 0);
        // Pieces on the invoice, the first totals row (as in the PDF). Quantities
        // may arrive as DECIMAL strings, so coerce and skip anything non-numeric
        // (no NaN). "1,234" when whole, else up to 2dp — same rule as PdfService.
        const totalQty = computed(() =>
            (invoice.value.items || [])
                .reduce((sum, item) => {
                    const qty = Number(item.quantity);
                    return Number.isFinite(qty) ? sum + qty : sum;
                }, 0)
                .toLocaleString("en-US", { maximumFractionDigits: 2 })
        );

        // Payment rows between the total and the balance, like the PDF: a sale's
        // Cash / Whish amounts, a return's money handed back. The client sends a
        // `payments` list; an older payload carries a single `payment` (+ optional
        // paymentLabel) instead. Zero amounts are left out.
        const paymentRows = computed(() => {
            if (isDelivery.value) return [];
            const { payments, payment, paymentLabel } = invoice.value;
            const rows = Array.isArray(payments)
                ? payments
                : [
                      {
                          label:
                              paymentLabel ||
                              (isReturn.value ? "Returned Payment" : "Payment"),
                          amount: payment,
                      },
                  ];
            return rows.filter(
                (row) => row && row.amount != null && Number(row.amount) !== 0
            );
        });
        // The balance changes over time, so it is stamped with when the client
        // read it (balance_as_of); a payload without one falls back to now.
        const asOf = computed(() => {
            const read = new Date(invoice.value.balance_as_of);
            return formatStamp(
                invoice.value.balance_as_of && !isNaN(read) ? read : new Date()
            );
        });

        // Close the (hidden) window once the OS print dialog is dismissed,
        // whether the user printed or cancelled.
        window.addEventListener("afterprint", () => window.close());

        // Receive the invoice from the main process over the "printDocument"
        // channel exposed by preload.js (contextBridge → window.electron.print).
        if (window.electron && window.electron.print) {
            window.electron.print((event, data) => {
                invoice.value = data || { items: [] };
                // Let Vue paint the data, then open the system print dialog.
                nextTick(() => window.print());
            });
        } else {
            // Opened outside Electron (e.g. a browser preview): nothing to print.
            console.warn("window.electron bridge not found — running outside Electron.");
        }

        return {
            invoice,
            asOf,
            currency,
            isDelivery,
            docTitle,
            recipientLabel,
            recipientName,
            dateValue,
            grandTotal,
            lineTotal,
            totalQty,
            paymentRows,
        };
    },
}).mount("#app");
