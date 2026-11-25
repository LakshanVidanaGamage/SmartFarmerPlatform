(() => {
    "use strict";

    const API = "/api/admin";
    const PAGE_SIZE = 10;
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const pageState = {};
    const sortFields = {
        farmers: { 0: "name", 3: "active_produce", 4: "created_at" }, buyers: { 0: "name", 2: "created_at" },
        produce: { 0: "name", 3: "quantity", 4: "price" },
        offers: { 1: "produce", 6: "status", 7: "created_at" }, orders: { 1: "produce", 6: "status", 7: "created_at" }
    };
    let filtersLoaded = false;
    let feedbackTimer = null;
    let confirmResolver = null;

    function t(key, params = {}) {
        let value = window.SmartFarmerI18n?.translateKey(key) || key;
        Object.entries(params).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)); });
        return value;
    }

    const columns = {
        farmers: [["admin.col.farmer", r => stack(r.full_name, r.email)], ["admin.col.phone", r => r.phone], ["admin.col.districts", r => r.districts || "—"], ["admin.col.availableListings", r => r.active_produce_count], ["admin.col.joined", r => formatDate(r.created_at)]],
        buyers: [["admin.col.buyer", r => stack(r.full_name, r.email)], ["admin.col.phone", r => r.phone], ["admin.col.joined", r => formatDate(r.created_at)]],
        produce: [["admin.col.listing", r => stack(r.produce_name, `ID ${r.produce_id}`)], ["admin.col.farmerName", r => stack(r.farmer_name, `ID ${r.farmer_id}`)], ["admin.col.category", r => r.category_name || t("admin.value.uncategorized")], ["admin.col.quantity", r => `${formatNumber(r.quantity)} ${r.unit}`], ["admin.col.priceUnit", r => `${formatMoney(r.price_per_unit)} / ${r.unit}`], ["admin.col.district", r => r.district], ["admin.col.availability", r => badge(r.available ? "available" : "unavailable")]],
        offers: [["admin.col.offer", r => `#${r.offer_id}`], ["admin.col.produce", r => r.produce_name], ["admin.col.farmerName", r => r.farmer_name], ["admin.col.buyerName", r => r.buyer_name], ["admin.col.offerPrice", r => formatMoney(r.offered_price)], ["admin.col.quantity", r => formatNumber(r.quantity)], ["admin.col.status", r => badge(r.status)], ["admin.col.submitted", r => formatDate(r.created_at)]],
        orders: [["admin.col.order", r => `#${r.order_id}`], ["admin.col.produce", r => r.produce_name], ["admin.col.farmerName", r => r.farmer_name], ["admin.col.buyerName", r => r.buyer_name], ["admin.col.quantity", r => formatNumber(r.quantity)], ["admin.col.total", r => formatMoney(r.total_amount)], ["admin.col.status", r => badge(r.status)], ["admin.col.created", r => formatDate(r.created_at)]],
        categories: [["admin.col.category", r => r.category_name], ["admin.col.categoryId", r => r.category_id], ["admin.col.actions", r => categoryActions(r)]]
    };

    function stack(primary, secondary) {
        const wrapper = document.createElement("span");
        const first = document.createElement("span");
        first.className = "table-primary";
        first.textContent = String(primary ?? "");
        wrapper.appendChild(first);
        if (secondary) {
            const second = document.createElement("span");
            second.className = "table-secondary";
            second.textContent = String(secondary);
            wrapper.appendChild(second);
        }
        return wrapper;
    }

    function badge(value) {
        const tag = document.createElement("span");
        const normalized = String(value ?? "").toLowerCase().replace(/[^a-z-]/g, "");
        tag.className = `status-badge status-${normalized}`;
        const translated = t(`status.${normalized}`);
        tag.textContent = translated === `status.${normalized}` ? String(value ?? "") : translated;
        return tag;
    }

    function formatDate(value) {
        if (!value) return "—";
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString(document.documentElement.lang);
    }

    function formatNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 2 }).format(number) : "—";
    }

    function formatMoney(value) {
        const number = Number(value);
        try {
            return Number.isFinite(number) ? new Intl.NumberFormat(`${document.documentElement.lang}-LK`, { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(number) : "—";
        } catch (_) {
            return Number.isFinite(number) ? `LKR ${number.toFixed(2)}` : "—";
        }
    }

    async function request(path, options = {}) {
        const headers = new Headers(options.headers || {});
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
        let response;
        try { response = await fetch(`${API}${path}`, { ...options, headers, credentials: "same-origin" }); }
        catch (_) { throw new Error(t("admin.error.network")); }
        let result;
        try { result = await response.json(); } catch (_) { throw new Error(t("admin.error.unreadable")); }
        if (!response.ok || result.success === false) {
            const error = new Error(window.SmartFarmerI18n?.translateText(result.message || t("admin.error.request")) || result.message || t("admin.error.request"));
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function showFeedback(message, kind = "success") {
        const feedback = document.getElementById("admin-feedback");
        if (!feedback) return;
        window.clearTimeout(feedbackTimer);
        feedback.hidden = false;
        feedback.className = `admin-feedback is-${kind}`;
        feedback.textContent = message;
        feedbackTimer = window.setTimeout(() => { feedback.hidden = true; }, 5500);
    }

    function currentSection() { return document.querySelector(".admin-section.is-visible")?.dataset.panel || "overview"; }

    function setSection(name) {
        const target = document.querySelector(`[data-panel="${name}"]`);
        if (!target) return;
        document.querySelectorAll(".admin-section").forEach(panel => {
            const active = panel === target;
            panel.classList.toggle("is-visible", active);
            panel.hidden = !active;
        });
        document.querySelectorAll("[data-section-link]").forEach(link => {
            const active = link.dataset.sectionLink === name;
            link.classList.toggle("is-active", active);
            if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
        });
        const title = document.getElementById("page-title");
        const activeLink = document.querySelector(`[data-section-link="${name}"] [data-i18n]`);
        if (title && activeLink) title.textContent = t(activeLink.dataset.i18n);
        closeSidebar();
        if (name === "overview") loadOverview();
        else loadFilters().then(() => loadList(name)).catch(error => showFeedback(error.message, "error"));
    }

    function openSidebar() {
        document.getElementById("admin-shell")?.classList.add("is-sidebar-open");
        const button = document.getElementById("sidebar-toggle");
        button?.setAttribute("aria-expanded", "true");
        if (button) button.setAttribute("aria-label", t("admin.nav.close"));
        const backdrop = document.getElementById("sidebar-backdrop");
        if (backdrop) backdrop.hidden = false;
    }

    function closeSidebar() {
        document.getElementById("admin-shell")?.classList.remove("is-sidebar-open");
        const button = document.getElementById("sidebar-toggle");
        button?.setAttribute("aria-expanded", "false");
        if (button) button.setAttribute("aria-label", t("admin.nav.open"));
        const backdrop = document.getElementById("sidebar-backdrop");
        if (backdrop) backdrop.hidden = true;
    }

    async function loadFilters() {
        if (filtersLoaded) return;
        const data = await request("/filters");
        populateSelect("farmer-district-filter", data.farmer_districts || [], t("admin.filter.allDistricts"));
        populateSelect("produce-farmer-filter", data.farmers || [], t("admin.filter.allFarmers"), "user_id", "full_name");
        populateSelect("produce-category-filter", data.categories || [], t("admin.filter.allCategories"), "category_id", "category_name");
        filtersLoaded = true;
    }

    function populateSelect(id, items, placeholder, valueKey = null, labelKey = null) {
        const select = document.getElementById(id);
        if (!select) return;
        const previous = select.value;
        select.replaceChildren(new Option(placeholder, ""));
        items.forEach(item => select.add(new Option(String(labelKey ? item[labelKey] : item), String(valueKey ? item[valueKey] : item))));
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }

    function animateMetric(node, value) {
        const target = Number(value);
        if (!node || !Number.isFinite(target)) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            node.textContent = formatNumber(target);
            return;
        }
        const started = performance.now();
        const duration = 650;
        const frame = now => {
            const progress = Math.min(1, (now - started) / duration);
            node.textContent = formatNumber(Math.round(target * (1 - (1 - progress) ** 3)));
            if (progress < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    async function loadOverview() {
        try {
            const data = await request("/overview");
            const ids = { total_users: "metric-users", farmers: "metric-farmers", buyers: "metric-buyers", total_produce: "metric-produce", total_offers: "metric-offers", total_orders: "metric-orders" };
            Object.entries(ids).forEach(([key, id]) => animateMetric(document.getElementById(id), data.metrics[key] || 0));
            renderStatusSummary("offer-status-summary", data.offers_by_status);
            renderStatusSummary("order-status-summary", data.orders_by_status);
        } catch (error) { showFeedback(error.message, "error"); }
    }

    function renderStatusSummary(id, counts) {
        const container = document.getElementById(id);
        if (!container) return;
        container.replaceChildren();
        const entries = Object.entries(counts || {}).map(([status, value]) => [status, Math.max(0, Number(value) || 0)]);
        const grandTotal = entries.reduce((sum, [, total]) => sum + total, 0);
        entries.forEach(([status, total]) => {
            const item = document.createElement("div"); item.className = "status-item";
            const name = document.createElement("span"); name.textContent = t(`status.${status}`) === `status.${status}` ? status : t(`status.${status}`);
            const count = document.createElement("strong"); count.textContent = formatNumber(total);
            const track = document.createElement("span"); track.className = "status-meter"; track.setAttribute("aria-hidden", "true");
            const fill = document.createElement("span"); fill.className = "status-meter-fill";
            fill.style.width = grandTotal ? `${(total / grandTotal) * 100}%` : "0%";
            track.appendChild(fill);
            item.dataset.status = status;
            item.append(name, count, track); container.appendChild(item);
        });
    }

    function formQuery(key) {
        const form = document.querySelector(`[data-list-form="${key}"]`);
        const params = new URLSearchParams({ page: String(pageState[key]?.page || 1), per_page: String(PAGE_SIZE) });
        if (pageState[key]?.sort) {
            params.set("sort", pageState[key].sort);
            params.set("direction", pageState[key].direction || "asc");
        }
        if (form) new FormData(form).forEach((value, name) => { const text = String(value).trim(); if (text && text !== "all") params.set(name, text); });
        return params;
    }

    async function loadList(key) {
        const isPrices = key === "prices";
        if (!isPrices && !columns[key]) return;
        const render = isPrices ? renderPriceCards : (items) => renderTable(key, items);
        if (isPrices) {
            renderPriceCards([], "admin.state.loading");
            updatePriceSort();
        } else {
            const body = document.getElementById(`body-${key}`);
            if (body) body.replaceChildren(makeEmptyRow(columns[key].length, t("admin.state.loading")));
        }
        try {
            const resource = isPrices ? "market-prices" : key;
            const result = await request(`/${resource}?${formQuery(key).toString()}`);
            render(result.items || []);
            renderPagination(key, result);
        } catch (error) { render([]); showFeedback(error.message, "error"); }
    }

    function changeSort(key, sortKey) {
        const direction = pageState[key]?.sort === sortKey && pageState[key]?.direction === "asc" ? "desc" : "asc";
        pageState[key] = { ...(pageState[key] || {}), sort: sortKey, direction, page: 1 };
        loadList(key);
    }

    function updatePriceSort() {
        document.querySelectorAll("[data-price-sort]").forEach(button => {
            const active = pageState.prices?.sort === button.dataset.priceSort;
            button.setAttribute("aria-pressed", String(active));
            if (active) {
                const direction = pageState.prices.direction;
                button.dataset.direction = direction;
                button.setAttribute("aria-description", t(direction === "asc" ? "admin.prices.ascending" : "admin.prices.descending"));
            } else {
                delete button.dataset.direction;
                button.removeAttribute("aria-description");
            }
        });
    }

    function priceDetail(labelKey, value) {
        const detail = document.createElement("div");
        const label = document.createElement("dt");
        label.textContent = t(labelKey);
        const content = document.createElement("dd");
        content.append(value);
        detail.append(label, content);
        return detail;
    }

    function renderPriceCards(rows, statusKey = "admin.state.empty") {
        const grid = document.getElementById("body-prices");
        const status = document.getElementById("prices-status");
        const actions = document.getElementById("prices-view-actions");
        status.hidden = rows.length > 0;
        status.textContent = status.hidden ? "" : t(statusKey);
        actions.hidden = rows.length <= 6;

        const cards = rows.map((row, index) => {
            const card = document.createElement("article");
            card.className = "sf-market-price-card";
            if (index >= 6) card.hidden = true;
            const media = document.createElement("div");
            media.className = "sf-market-price-media";
            const image = document.createElement("img");
            image.dataset.produceImage = "";
            image.dataset.produceImageFallback = "mixed";
            image.dataset.produceName = row.produce_name;
            image.alt = row.produce_name;
            image.loading = "lazy";
            image.decoding = "async";
            media.append(image);

            const body = document.createElement("div");
            body.className = "sf-market-price-body";
            const title = document.createElement("h3");
            title.textContent = row.produce_name;
            const amount = document.createElement("p");
            amount.className = "sf-market-price-amount";
            const price = document.createElement("strong");
            price.textContent = formatMoney(row.price_per_kg);
            const unit = document.createElement("span");
            unit.textContent = t("buyer.prices.perKg");
            amount.append(price, " ", unit);

            const details = document.createElement("dl");
            details.className = "sf-market-price-details";
            const market = priceDetail("admin.col.market", row.market_name);
            if (row.district) {
                const district = document.createElement("span");
                district.textContent = row.district;
                market.lastElementChild.append(district);
            }
            const date = document.createElement("time");
            date.dateTime = row.price_date;
            date.textContent = formatDate(row.price_date);
            details.append(market, priceDetail("admin.col.priceDate", date));

            body.append(title, amount, details, priceActions(row));
            card.append(media, body);
            return card;
        });
        grid.replaceChildren(...cards);
    }

    function makeEmptyRow(columnCount, message) {
        const row = document.createElement("tr"); const cell = document.createElement("td");
        cell.colSpan = columnCount; cell.className = "empty-state"; cell.textContent = message; row.appendChild(cell); return row;
    }

    function renderTable(key, rows) {
        const definition = columns[key]; const head = document.getElementById(`head-${key}`); const body = document.getElementById(`body-${key}`);
        if (!head || !body) return;
        head.replaceChildren(); const heading = document.createElement("tr");
        definition.forEach(([labelKey], index) => {
            const th = document.createElement("th"); th.scope = "col";
            const sortKey = sortFields[key]?.[index];
            if (sortKey) {
                const button = document.createElement("button"); button.type = "button"; button.className = "sort-button"; button.textContent = t(labelKey);
                const currentSort = pageState[key]?.sort === sortKey;
                if (currentSort) {
                    button.dataset.direction = pageState[key].direction || "asc";
                    th.setAttribute("aria-sort", (pageState[key].direction || "asc") === "asc" ? "ascending" : "descending");
                }
                button.addEventListener("click", () => changeSort(key, sortKey));
                th.appendChild(button);
            } else th.textContent = t(labelKey);
            heading.appendChild(th);
        });
        head.appendChild(heading); body.replaceChildren();
        if (!rows.length) { body.appendChild(makeEmptyRow(definition.length, t("admin.state.empty"))); return; }
        rows.forEach(row => {
            const tr = document.createElement("tr");
            definition.forEach(([labelKey, render]) => {
                const td = document.createElement("td"); td.dataset.label = t(labelKey);
                const value = render(row);
                if (value instanceof Node) td.appendChild(value); else td.textContent = String(value ?? "—") || "—";
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    function renderPagination(key, result) {
        const container = document.querySelector(`[data-pagination="${key}"]`); if (!container) return;
        const page = Number(result.page || 1); const pages = Number(result.pages || 0); pageState[key] = { ...(pageState[key] || {}), page };
        container.replaceChildren();
        const summary = document.createElement("span");
        summary.textContent = result.total ? t("admin.pagination.showing", { page, pages, count: formatNumber(result.total) }) : t("admin.pagination.none");
        const controls = document.createElement("div"); controls.className = "pagination-controls";
        controls.append(pageButton(t("admin.action.previous"), page <= 1, () => changePage(key, page - 1)), pageButton(t("admin.action.next"), page >= pages, () => changePage(key, page + 1)));
        container.append(summary, controls);
    }

    function pageButton(label, disabled, onClick) { const button = document.createElement("button"); button.type = "button"; button.className = "button button-quiet button-small"; button.textContent = label; button.disabled = disabled; button.addEventListener("click", onClick); return button; }
    function changePage(key, page) { pageState[key] = { ...(pageState[key] || {}), page }; loadList(key); }
    function actionButton(labelKey, className, onClick) { const button = document.createElement("button"); button.type = "button"; button.className = `button button-small ${className}`; button.textContent = t(labelKey); button.addEventListener("click", onClick); return button; }
    function priceActions(row) { const wrap = document.createElement("div"); wrap.className = "table-actions"; wrap.append(actionButton("admin.action.edit", "button-quiet", () => openPriceDialog(row)), actionButton("admin.action.delete", "button-danger", () => deletePrice(row))); return wrap; }
    function categoryActions(row) { const wrap = document.createElement("div"); wrap.className = "table-actions"; wrap.append(actionButton("admin.action.rename", "button-quiet", () => openCategoryDialog(row)), actionButton("admin.action.delete", "button-danger", () => deleteCategory(row))); return wrap; }

    function openPriceDialog(row = null) {
        const dialog = document.getElementById("price-dialog"); const form = document.getElementById("price-form"); form.reset();
        form.elements.price_id.value = row?.price_id || ""; form.elements.produce_name.value = row?.produce_name || ""; form.elements.market_name.value = row?.market_name || ""; form.elements.district.value = row?.district || ""; form.elements.price_per_kg.value = row?.price_per_kg ?? ""; form.elements.price_date.value = row?.price_date || new Date().toISOString().slice(0, 10);
        document.getElementById("price-dialog-title").textContent = t(row ? "admin.prices.editTitle" : "admin.prices.addTitle"); clearFormError("price-form-error"); dialog.showModal();
    }

    function openCategoryDialog(row = null) {
        const dialog = document.getElementById("category-dialog"); const form = document.getElementById("category-form"); form.reset();
        form.elements.category_id.value = row?.category_id || ""; form.elements.category_name.value = row?.category_name || "";
        document.getElementById("category-dialog-title").textContent = t(row ? "admin.categories.renameTitle" : "admin.categories.addTitle"); clearFormError("category-form-error"); dialog.showModal();
    }

    function clearFormError(id) { const node = document.getElementById(id); if (node) { node.hidden = true; node.textContent = ""; } }

    function askConfirmation(message) {
        const dialog = document.getElementById("confirm-dialog");
        document.getElementById("confirm-message").textContent = message;
        dialog.showModal();
        return new Promise(resolve => { confirmResolver = resolve; });
    }

    function resolveConfirmation(value) {
        document.getElementById("confirm-dialog")?.close();
        if (confirmResolver) { confirmResolver(value); confirmResolver = null; }
    }

    async function deletePrice(row) {
        if (!await askConfirmation(t("admin.confirm.price", { produce: row.produce_name, market: row.market_name }))) return;
        try { await request(`/market-prices/${row.price_id}`, { method: "DELETE" }); showFeedback(t("admin.success.priceDeleted")); loadList("prices"); loadOverview(); }
        catch (error) { showFeedback(error.message, "error"); }
    }

    async function deleteCategory(row) {
        if (!await askConfirmation(t("admin.confirm.category", { category: row.category_name }))) return;
        try { await request(`/categories/${row.category_id}`, { method: "DELETE" }); filtersLoaded = false; showFeedback(t("admin.success.categoryDeleted")); loadList("categories"); loadOverview(); }
        catch (error) { showFeedback(error.message, "error"); }
    }

    function closeDialog(id) { document.getElementById(id)?.close(); }

    function initForms() {
        document.querySelectorAll("[data-list-form]").forEach(form => {
            const key = form.dataset.listForm;
            form.addEventListener("submit", event => { event.preventDefault(); pageState[key] = { ...(pageState[key] || {}), page: 1 }; loadList(key); });
            form.addEventListener("reset", () => window.setTimeout(() => { pageState[key] = { ...(pageState[key] || {}), page: 1 }; loadList(key); }, 0));
        });
        document.getElementById("price-form").addEventListener("submit", async event => {
            event.preventDefault(); const form = event.currentTarget; const id = form.elements.price_id.value;
            const payload = { produce_name: form.elements.produce_name.value.trim(), market_name: form.elements.market_name.value.trim(), district: form.elements.district.value.trim(), price_per_kg: form.elements.price_per_kg.value, price_date: form.elements.price_date.value };
            try {
                await request(id ? `/market-prices/${id}` : "/market-prices", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
                closeDialog("price-dialog"); showFeedback(t(id ? "admin.success.priceUpdated" : "admin.success.priceAdded")); loadList("prices"); loadOverview();
            } catch (error) { const field = document.getElementById("price-form-error"); field.textContent = error.message; field.hidden = false; }
        });
        document.getElementById("category-form").addEventListener("submit", async event => {
            event.preventDefault(); const form = event.currentTarget; const id = form.elements.category_id.value;
            try {
                await request(id ? `/categories/${id}` : "/categories", { method: id ? "PUT" : "POST", body: JSON.stringify({ category_name: form.elements.category_name.value.trim() }) });
                closeDialog("category-dialog"); filtersLoaded = false; showFeedback(t(id ? "admin.success.categoryUpdated" : "admin.success.categoryAdded")); loadList("categories"); loadOverview();
            } catch (error) { const field = document.getElementById("category-form-error"); field.textContent = error.message; field.hidden = false; }
        });
    }

    function initialise() {
        document.querySelectorAll("[data-section-link]").forEach(button => button.addEventListener("click", () => setSection(button.dataset.sectionLink)));
        document.querySelectorAll("[data-jump]").forEach(button => button.addEventListener("click", () => setSection(button.dataset.jump)));
        document.getElementById("sidebar-toggle")?.addEventListener("click", () => document.getElementById("admin-shell")?.classList.contains("is-sidebar-open") ? closeSidebar() : openSidebar());
        document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebar);
        document.addEventListener("keydown", event => { if (event.key === "Escape") { closeSidebar(); resolveConfirmation(false); } });
        document.getElementById("add-price")?.addEventListener("click", () => openPriceDialog());
        document.querySelectorAll("[data-price-sort]").forEach(button => {
            button.addEventListener("click", () => changeSort("prices", button.dataset.priceSort));
        });
        document.getElementById("prices-view-more")?.addEventListener("click", event => {
            const button = event.currentTarget;
            const expanded = button.getAttribute("aria-expanded") !== "true";
            document.querySelectorAll("#body-prices > .sf-market-price-card").forEach((card, index) => {
                card.hidden = !expanded && index >= 6;
            });
            button.setAttribute("aria-expanded", String(expanded));
            button.textContent = t(expanded ? "marketPrices.showLess" : "marketPrices.viewMore");
        });
        document.getElementById("add-category")?.addEventListener("click", () => openCategoryDialog());
        document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
        document.querySelectorAll("[data-cancel-confirm]").forEach(button => button.addEventListener("click", () => resolveConfirmation(false)));
        document.getElementById("confirm-action")?.addEventListener("click", () => resolveConfirmation(true));
        document.getElementById("confirm-dialog")?.addEventListener("close", () => { if (confirmResolver) resolveConfirmation(false); });
        initForms();
        const requestedSection = window.location.hash.slice(1);
        setSection(requestedSection === "prices" || Object.prototype.hasOwnProperty.call(columns, requestedSection) ? requestedSection : "overview");
        document.addEventListener("sf:languagechange", () => {
            const active = currentSection();
            filtersLoaded = false;
            if (active === "overview") loadOverview();
            else loadFilters().then(() => loadList(active)).catch(error => showFeedback(error.message, "error"));
            if (active !== "overview") { const link = document.querySelector(`[data-section-link="${active}"] [data-i18n]`); const title = document.getElementById("page-title"); if (title && link) title.textContent = t(link.dataset.i18n); }
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
    else initialise();
})();
