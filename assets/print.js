const { createApp, ref, computed, watchEffect, nextTick } = Vue;

createApp({
    setup() {
        // Start with an empty items array so the v-for has something to bind to
        // before the invoice arrives from the main process.
        const invoice = ref({ items: [] });

        // "30 September 2026" — the date half of the stamp below.
        const formatDay = (date) =>
            date.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
            });
        // "as of" stamp under the balance, same format as the Angular PDF:
        // "30 September 2026, 14:05". Date and time are formatted apart because a
        // combined toLocaleString reads "… at 14:05" on newer ICU.
        const formatStamp = (date) =>
            formatDay(date) +
            ", " +
            date.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            });
        // A date from the API ("2026-09-30" or "2026-09-30 13:58:00") read as
        // local time: new Date() takes a bare date as UTC midnight, the day
        // before west of Greenwich. An ISO stamp with a zone goes through Date
        // as is. Anything else is null — Date would read "06/10/2026" as
        // 10 June, and a wrong date is worse than the text as given.
        const toDate = (value) => {
            if (value == null || value === "") return null;
            // IPC is a structured clone: a Date sent as such arrives as one.
            if (value instanceof Date) return isNaN(value) ? null : value;
            const text = String(value).trim();
            const m =
                /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(
                    text
                );
            if (m) {
                const date = new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
                // "2026-13-45" would roll over into another date
                return date.getMonth() === m[2] - 1 && date.getDate() === +m[3] ? date : null;
            }
            const date = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
                ? new Date(text)
                : null;
            return date && !isNaN(date) ? date : null;
        };

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

        // Banner name, from the client's environment (`brand`); payloads from an
        // older client bundle don't carry it.
        const brand = computed(() => invoice.value.brand || "KARIZMA");

        // ── Sales vs return vs delivery vs quotation (mirrors PdfService.exportInvoicePDF) ──
        const isDelivery = computed(() => invoice.value.type === "delivery");
        // A return prints like a sale (same balance block) under its own title.
        const isReturn = computed(() => invoice.value.type === "return");
        // A quotation bills a customer like a sale but takes no money: no
        // payment or balance tiles, and its prices are dated instead.
        const isQuotation = computed(() => invoice.value.type === "quotation");
        const docTitle = computed(() =>
            isDelivery.value
                ? "DELIVERY"
                : isReturn.value
                  ? "RETURN"
                  : isQuotation.value
                    ? "QUOTATION"
                    : "INVOICE"
        );
        // "Invoice Number" / footer "Invoice #…"; a quotation is not an invoice.
        const docKind = computed(() =>
            isQuotation.value ? "Quotation" : "Invoice"
        );
        // A quotation may arrive with its own field names (quotation_number,
        // quotation_date / _datetime) rather than mapped onto the invoice ones.
        const docNumber = computed(
            () => invoice.value.invoice_number ?? invoice.value.quotation_number
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
        // Who prepared / last edited the order (names from the server). The
        // editor shows only when it is someone else, as in the PDF; older
        // invoices and client payloads carry neither and print as before.
        const nameOf = (value) => (value == null ? "" : String(value).trim());
        const preparedBy = computed(() => nameOf(invoice.value.prepared_by_name));
        const editedBy = computed(() => {
            const name = nameOf(invoice.value.edited_by_name);
            return name !== preparedBy.value ? name : "";
        });
        const dateValue = computed(() =>
            isDelivery.value
                ? invoice.value.order_datetime
                : isQuotation.value
                  ? invoice.value.order_date ||
                    invoice.value.quotation_date ||
                    invoice.value.quotation_datetime
                  : invoice.value.order_date
        );
        // A quotation's prices are a snapshot (no expiry), so it says from when:
        // the quotation's own date — a reprint keeps it — or `valid_as_of` when
        // the client sends one. Unreadable → the text as given; none → today.
        const validAsOf = computed(() => {
            const raw = invoice.value.valid_as_of || dateValue.value;
            const date = toDate(raw);
            return date ? formatDay(date) : raw ? String(raw) : formatDay(new Date());
        });
        const grandTotal = computed(() =>
            isDelivery.value
                ? invoice.value.total_price ?? invoice.value.total_amount
                : invoice.value.total_amount
        );
        // Delivery items have no per-line total → derive it.
        const lineTotal = (item) =>
            item.total_price ?? item.quantity * (item.unit_price || 0);
        // Pieces on the invoice, the first summary tile (as in the PDF). Quantities
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

        // Payment tiles between the total and the balance, like the PDF: a sale's
        // Cash / Whish amounts, a return's money handed back. The client sends a
        // `payments` list; an older payload carries a single `payment` (+ optional
        // paymentLabel) instead. Zero amounts are left out.
        const paymentRows = computed(() => {
            if (isDelivery.value || isQuotation.value) return [];
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
        // Remaining balance: sales / returns, when the payload carries it (none
        // on a cash sale — no customer). Never on a quotation, even if sent.
        const showBalance = computed(
            () =>
                !isDelivery.value &&
                !isQuotation.value &&
                invoice.value.balance != null
        );
        // The balance changes over time, so it is stamped with when the client
        // read it (balance_as_of); a payload without one falls back to now.
        const asOf = computed(() => {
            const read = new Date(invoice.value.balance_as_of);
            return formatStamp(
                invoice.value.balance_as_of && !isNaN(read) ? read : new Date()
            );
        });

        // Footer, left half: "Invoice #<number>" ("Quotation #…") on every page,
        // beside the "Page X of Y" in print.html. A page margin box shows only
        // CSS `content`, so the number goes in as an @page rule of its own.
        const cssString = (text) =>
            '"' + String(text).replace(/["\\]/g, "\\$&").replace(/[\r\n\f]/g, " ") + '"';
        const pageFooter = document.createElement("style");
        document.head.appendChild(pageFooter);
        watchEffect(() => {
            const number = docNumber.value;
            pageFooter.textContent =
                number == null || number === ""
                    ? ""
                    : `@page { @bottom-left { content: ${cssString(docKind.value + " #" + number)}; } }`;
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
            brand,
            asOf,
            currency,
            isDelivery,
            isQuotation,
            docTitle,
            docKind,
            docNumber,
            recipientLabel,
            recipientName,
            preparedBy,
            editedBy,
            dateValue,
            validAsOf,
            grandTotal,
            lineTotal,
            totalQty,
            paymentRows,
            showBalance,
        };
    },
}).mount("#app");
