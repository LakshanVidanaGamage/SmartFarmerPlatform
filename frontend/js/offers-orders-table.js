(() => {
    "use strict";

    const body = document.body;
    const role = body.classList.contains("sf-farmer-dashboard") ? "farmer" : "buyer";
    const view = body.dataset.pageView;
    if (!(["offers", "orders"].includes(view))) return;

    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const translate = (key, fallback, values = {}) => {
        let value = window.SmartFarmerI18n?.translateKey(key, document.documentElement.lang || "en") || fallback;
        Object.entries(values).forEach(([name, item]) => { value = value.replaceAll(`{${name}}`, String(item)); });
        return value;
    };
    const configs = {
        farmer: {
            offers: { id: "receivedOffers", endpoint: "/api/received-offers", title: "farmer.offers.empty.title", empty: "No offers received yet.", columns: [["listing.table.offerId", "Offer ID", "id"], ["farmer.offer.buyer", "Buyer", "person"], ["farmer.order.produce", "Produce", "produce"], ["farmer.offer.quantity", "Requested quantity", "quantity"], ["farmer.offer.price", "Offered price per unit", "price"], ["buyer.record.date", "Date", "date"], ["farmer.order.status", "Status", "status"], ["listing.table.actions", "Actions", "actions"]] },
            orders: { id: "farmerOrders", endpoint: "/api/farmer/orders", title: "farmer.orders.empty.title", empty: "No orders yet.", columns: [["listing.table.orderId", "Order ID", "id"], ["farmer.order.buyer", "Buyer", "person"], ["farmer.order.produce", "Produce", "produce"], ["farmer.order.quantity", "Quantity", "quantity"], ["farmer.order.total", "Total amount", "total"], ["buyer.record.date", "Date", "date"], ["farmer.order.status", "Status", "status"], ["listing.table.actions", "Actions", "actions"]] }
        },
        buyer: {
            offers: { id: "offersList", endpoint: "/api/my-offers", title: "buyer.offers.emptyTitle", empty: "No offers yet.", columns: [["listing.table.offerId", "Offer ID", "id"], ["buyer.record.farmer", "Farmer", "person"], ["farmer.order.produce", "Produce", "produce"], ["farmer.offer.quantity", "Requested quantity", "quantity"], ["buyer.record.offerPrice", "Offered price per unit", "price"], ["buyer.record.date", "Date", "date"], ["farmer.order.status", "Status", "status"]] },
            orders: { id: "ordersList", endpoint: "/api/my-orders", title: "buyer.orders.emptyTitle", empty: "No orders yet.", columns: [["listing.table.orderId", "Order ID", "id"], ["buyer.record.farmer", "Farmer", "person"], ["farmer.order.produce", "Produce", "produce"], ["buyer.record.quantity", "Quantity", "quantity"], ["buyer.record.total", "Total amount", "total"], ["buyer.record.date", "Date", "date"], ["farmer.order.status", "Status", "status"], ["listing.table.actions", "Actions", "actions"]] }
        }
    };
    const config = configs[role][view];
    const container = document.getElementById(config.id);
    if (!container) return;
    const feedback = element("div", "sf-listing-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    container.parentElement?.insertBefore(feedback, container);
    const responseKey = view === "offers" ? "offers" : "orders";
    const recordId = view === "offers" ? "offer_id" : "order_id";
    let currentRows = [];
    let hasLoaded = false;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text ?? "");
        return node;
    }
    function dateText(value) {
        const parsed = value ? new Date(value) : null;
        return parsed && !Number.isNaN(parsed.getTime())
            ? new Intl.DateTimeFormat(document.documentElement.lang || "en", { dateStyle: "medium" }).format(parsed)
            : (value || "—");
    }
    function actionButton(label, status, id) {
        const button = element("button", "sf-listing-action", label);
        button.type = "button";
        if (role === "farmer") {
            button.dataset.offerId = view === "offers" ? id : "";
            button.dataset.orderId = view === "orders" ? id : "";
            button.dataset.status = status;
        } else {
            button.dataset.cancelOrder = id;
            button.classList.add("bd-cancel-order");
            button.setAttribute("data-i18n", "buyer.orders.cancel");
        }
        return button;
    }
    function cell(row, value, kind) {
        const td = element("td");
        if (kind === "status") {
            const normalized = String(value || "pending").toLowerCase();
            const key = role === "farmer" ? `farmer.status.${normalized}` : `buyer.status.${normalized}`;
            td.append(element("span", `sf-listing-status sf-listing-status-${normalized}`, translate(key, normalized)));
        } else td.textContent = value;
        row.append(td);
    }
    function draw(rows, target, page) {
        target.replaceChildren();
        rows.slice((page - 1) * 10, page * 10).forEach((record) => {
            const tr = element("tr");
            const id = record[recordId];
            const values = {
                id: `#${id}`,
                person: view === "offers" ? (role === "farmer" ? record.buyer_name : record.farmer_name) : (role === "farmer" ? record.buyer_name : record.farmer_name),
                produce: record.produce_name,
                quantity: `${record.quantity ?? ""} ${record.unit || ""}`.trim(),
                price: `LKR ${Number(record.offered_price || 0).toFixed(2)} / ${record.unit || "kg"}`,
                total: `LKR ${Number(record.total_amount || 0).toFixed(2)}`,
                date: dateText(record.created_at),
                status: record.status
            };
            config.columns.forEach(([, , key]) => {
                if (key === "actions") {
                    const td = element("td");
                    const actions = element("div", "sf-listing-actions");
                    const status = String(record.status || "").toLowerCase();
                    if (role === "farmer" && view === "offers" && status === "pending") {
                        actions.append(actionButton(translate("farmer.offer.accept", "Accept offer"), "accepted", id), actionButton(translate("farmer.offer.reject", "Reject offer"), "rejected", id));
                    } else if (role === "farmer" && view === "orders" && status === "pending") {
                        actions.append(actionButton(translate("farmer.order.confirm", "Confirm"), "confirmed", id), actionButton(translate("farmer.order.cancel", "Cancel"), "cancelled", id));
                    } else if (role === "farmer" && view === "orders" && status === "confirmed") {
                        actions.append(actionButton(translate("farmer.order.complete", "Complete"), "completed", id), actionButton(translate("farmer.order.cancel", "Cancel"), "cancelled", id));
                    } else if (role === "buyer" && view === "orders" && status === "pending") {
                        actions.append(actionButton(translate("buyer.orders.cancel", "Cancel pending order"), "cancelled", id));
                    } else actions.append(element("span", "sf-listing-no-actions", translate("farmer.order.noActions", "—")));
                    td.append(actions); tr.append(td);
                } else cell(tr, values[key], key);
            });
            target.append(tr);
        });
    }
    function renderTable(rows) {
        currentRows = rows;
        hasLoaded = true;
        container.replaceChildren();
        let tbody = null;
        if (!rows.length) {
            const empty = element("div", "sf-listing-empty", translate(config.title, config.empty));
            container.append(empty);
        } else {
            const wrap = element("div", "sf-listing-table-wrap");
            const table = element("table", "sf-listing-table");
            const thead = element("thead"); const header = element("tr");
            config.columns.forEach(([key, fallback]) => header.append(element("th", "", translate(key, fallback))));
            thead.append(header);
            tbody = element("tbody");
            table.append(thead, tbody); wrap.append(table); container.append(wrap);
        }
        const pagination = element("nav", "sf-listing-pagination");
        pagination.setAttribute("aria-label", translate("admin.pagination.showing", "Pagination"));
        container.append(pagination);
        const pageCount = Math.max(1, Math.ceil(rows.length / 10));
        let page = 1;
        const showPage = (requested) => {
            page = Math.max(1, Math.min(requested, pageCount));
            if (tbody) draw(rows, tbody, page);
            pagination.replaceChildren();
            const previous = element("button", "", translate("admin.action.previous", "Previous"));
            previous.type = "button"; previous.disabled = page === 1;
            previous.addEventListener("click", () => showPage(page - 1));
            pagination.append(previous);
            for (let number = 1; number <= pageCount; number += 1) {
                const button = element("button", number === page ? "is-current" : "", number);
                button.type = "button"; button.setAttribute("aria-label", `${number}`);
                button.setAttribute("aria-current", number === page ? "page" : "false");
                button.addEventListener("click", () => showPage(number));
                pagination.append(button);
            }
            const indicator = element("span", "sf-listing-page-indicator", translate("marketPrices.pageOf", "Page {page} of {pages}", { page, pages: pageCount }));
            pagination.append(indicator);
            const next = element("button", "", translate("admin.action.next", "Next"));
            next.type = "button"; next.disabled = page === pageCount;
            next.addEventListener("click", () => showPage(page + 1));
            pagination.append(next);
        };
        showPage(1);
    }
    async function updateFarmerStatus(button) {
        const id = button.dataset.offerId || button.dataset.orderId;
        const status = button.dataset.status;
        const key = status === "accepted" ? "farmer.offer.acceptConfirm" : status === "rejected" ? "farmer.offer.rejectConfirm" : `farmer.order.${status}Prompt`;
        const fallback = status === "accepted" ? "Accept this offer?" : status === "rejected" ? "Reject this offer?" : `${status} this order?`;
        if (!window.confirm(translate(key, fallback))) return;
        const endpoint = button.dataset.offerId ? `/api/offers/${id}/status` : `/api/orders/${id}/status`;
        try {
            const response = await fetch(endpoint, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": csrf }, body: JSON.stringify({ status }) });
            const result = await response.json();
            if (!response.ok || !result.success) {
                feedback.textContent = translate(button.dataset.offerId ? "farmer.error.offerUpdate" : "farmer.error.orderUpdate", "Could not update this record. Please try again.");
                feedback.classList.add("is-visible", "is-error");
                return;
            }
            const successKey = button.dataset.offerId ? `farmer.offer.${status === "accepted" ? "accepted" : "rejected"}` : "farmer.order.updated";
            feedback.textContent = translate(successKey, "Status updated.");
            feedback.classList.add("is-visible", "is-success");
            await load();
        } catch (error) {
            feedback.textContent = translate("farmer.error.network", "A network error occurred. Please try again.");
            feedback.classList.add("is-visible", "is-error");
        }
    }
    async function load() {
        container.setAttribute("aria-busy", "true");
        try {
            const response = await fetch(config.endpoint, { credentials: "same-origin", headers: { Accept: "application/json" } });
            const result = await response.json();
            if (!response.ok || !result.success || !Array.isArray(result[responseKey])) throw new Error("Could not load records.");
            renderTable(result[responseKey]);
        } catch (error) {
            container.replaceChildren(element("div", "sf-listing-empty", translate("admin.error.network", "Could not load records. Please try again.")));
        } finally { container.removeAttribute("aria-busy"); }
    }
    if (role === "farmer") container.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-status]");
        if (button) updateFarmerStatus(button).catch(() => {});
    });
    document.addEventListener("sf:listing-refresh", load);
    document.addEventListener("sf:languagechange", () => {
        if (hasLoaded) renderTable(currentRows);
    });
    load();
})();
