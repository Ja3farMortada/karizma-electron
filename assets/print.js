const { createApp, ref, computed, nextTick } = Vue;

createApp({
    setup() {
        // Start with an empty items array so the v-for has something to bind to
        // before the invoice arrives from the main process.
        const invoice = ref({ items: [] });

        // Matches the "as of <date>" line in the Angular PDF.
        const today = new Date().toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
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

        // ── Sales vs delivery (mirrors PdfService.exportInvoicePDF) ──
        const isDelivery = computed(() => invoice.value.type === "delivery");
        const docTitle = computed(() =>
            isDelivery.value ? "DELIVERY" : "INVOICE"
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
            today,
            currency,
            isDelivery,
            docTitle,
            recipientLabel,
            recipientName,
            dateValue,
            grandTotal,
            lineTotal,
        };
    },
}).mount("#app");
