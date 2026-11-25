(() => {
    "use strict";

    const byId = (id) => document.getElementById(id);
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const mutationHeaders = (headers = {}) => ({ ...headers, "X-CSRFToken": csrfToken });
    const sidebar = byId("buyerSidebar");
    const navToggle = document.querySelector("[data-buyer-nav-toggle]");
    const offerDialog = byId("offerDialog");
    const offerForm = byId("offerForm");
    const cancelDialog = byId("cancelOrderDialog");
    const feedback = byId("buyerFeedback");
    let selectedProduce = null;
    let selectedOrder = null;
    let lastOfferTrigger = null;
    let lastCancelTrigger = null;
    let feedbackTimer = null;
    let activeProduceCategory = new URLSearchParams(window.location.search).get("category") || "all";

    const t = (key, values = {}) => {
        let message = window.SmartFarmerI18n?.translateKey(
            key,
            document.documentElement.lang || "en"
        ) || key;
        return message.replace(/\{([a-z][a-z0-9_-]*)\}/gi, (match, name) =>
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
        );
    };

    const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);

    const numberText = (value) => {
        const number = Number(value);
        return Number.isFinite(number)
            ? new Intl.NumberFormat(document.documentElement.lang || "en", { maximumFractionDigits: 2 }).format(number)
            : escapeHTML(value);
    };

    const priceText = (value) => {
        const number = Number(value);
        return Number.isFinite(number)
            ? new Intl.NumberFormat(document.documentElement.lang || "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
            : "0.00";
    };

    const dateText = (value) => {
        if (!value) return t("buyer.record.dateUnavailable");
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? escapeHTML(value)
            : new Intl.DateTimeFormat(document.documentElement.lang || "en", { dateStyle: "medium" }).format(date);
    };

    function translate(root = document) {
        window.SmartFarmerI18n?.apply(document.documentElement.lang || "en", root);
    }

    function showFeedback(key, kind = "success") {
        if (!feedback) return;
        feedback.textContent = t(key);
        feedback.setAttribute("data-i18n", key);
        feedback.classList.add("is-visible");
        feedback.classList.toggle("is-success", kind === "success");
        feedback.classList.toggle("is-error", kind === "error");
        if (feedbackTimer) window.clearTimeout(feedbackTimer);
        feedbackTimer = window.setTimeout(() => feedback.classList.remove("is-visible"), 5000);
    }

    function normaliseProduceName(value) {
        return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    }

    function filterProduceCards() {
        const input = byId("buyerProduceSearch");
        const list = byId("produceList");
        if (!input || !list) return;
        const query = normaliseProduceName(input.value);
        const cards = Array.from(list.querySelectorAll(".bd-produce-card"));
        let visibleCount = 0;
        cards.forEach((card) => {
            const name = normaliseProduceName(card.querySelector("h3")?.textContent);
            const image = card.querySelector("[data-produce-image]");
            const category = window.SmartFarmerProduceImages?.classify(
                card.querySelector("h3")?.textContent,
                image?.dataset.produceCategory || card.dataset.produceCategory
            ) || "other_crops";
            card.dataset.produceCategoryId = category;
            const matches = (!query || name.includes(query))
                && (activeProduceCategory === "all" || category === activeProduceCategory);
            if (typeof document !== "undefined" && document.body.dataset.pageView === "dashboard") {
                card.dataset.overviewFilterMatch = String(matches);
            }
            card.hidden = !matches;
            if (matches) visibleCount += 1;
        });
        const noMatches = byId("buyerSearchEmpty");
        if (noMatches) noMatches.hidden = visibleCount > 0;
        list.hidden = visibleCount === 0;
        const count = byId("produceSectionCount");
        if (count) {
            count.textContent = t("buyer.produce.count", { count: visibleCount });
            count.setAttribute("data-i18n", "buyer.produce.count");
            count.setAttribute("data-i18n-param-count", String(visibleCount));
        }
        if (typeof document !== "undefined" && document.body.dataset.pageView === "dashboard") {
            document.dispatchEvent(new CustomEvent("sf:overview-produce-filter"));
        }
    }

    function initialiseProduceSearch() {
        const input = byId("buyerProduceSearch");
        const clear = byId("buyerProduceSearchClear");
        if (!input) return;
        const categoryInput = byId("buyerProduceCategory");
        const categoryFilter = window.SmartFarmerProduceImages?.mountCategoryFilter(
            byId("buyerProduceCategoryFilter"),
            (category) => {
                activeProduceCategory = category;
                if (categoryInput) categoryInput.value = category === "all" ? "" : category;
                filterProduceCards();
            },
            activeProduceCategory
        );
        activeProduceCategory = categoryFilter?.getActive() || "all";
        if (categoryInput) categoryInput.value = activeProduceCategory === "all" ? "" : activeProduceCategory;
        input.addEventListener("input", filterProduceCards);
        clear?.addEventListener("click", () => {
            input.value = "";
            const queryParams = new URLSearchParams(window.location.search);
            if (queryParams.get("crop")) {
                input.form?.requestSubmit();
            } else {
                filterProduceCards();
                input.focus();
            }
        });
        filterProduceCards();
    }

    function setFormMessage(element, key = "") {
        if (!element) return;
        element.textContent = key ? t(key) : "";
        element.classList.toggle("is-visible", Boolean(key));
        if (key) element.setAttribute("data-i18n", key);
        else element.removeAttribute("data-i18n");
    }

    async function readResponse(response) {
        try {
            return await response.json();
        } catch (error) {
            return {};
        }
    }

    function statusMarkup(status) {
        const normalized = String(status || "pending").toLowerCase();
        const supported = ["pending", "accepted", "rejected", "confirmed", "completed", "cancelled"];
        const key = supported.includes(normalized) ? `buyer.status.${normalized}` : "buyer.status.pending";
        return `<span class="bd-status" data-status="${escapeHTML(normalized)}" data-i18n="${key}">${escapeHTML(t(key))}</span>`;
    }

    function offerCard(offer) {
        const unit = escapeHTML(offer.unit || "kg");
        return `<article class="bd-record-card">
            <div class="bd-record-heading"><div><p class="bd-record-kicker" data-i18n="buyer.record.offerNumber" data-i18n-param-id="${escapeHTML(offer.offer_id)}">${escapeHTML(t("buyer.record.offerNumber", { id: offer.offer_id }))}</p><h3>${escapeHTML(offer.produce_name)}</h3></div>${statusMarkup(offer.status)}</div>
            <dl class="bd-record-details">
                <div><dt data-i18n="buyer.record.farmer">${escapeHTML(t("buyer.record.farmer"))}</dt><dd>${escapeHTML(offer.farmer_name)}</dd></div>
                <div><dt data-i18n="buyer.record.quantity">${escapeHTML(t("buyer.record.quantity"))}</dt><dd>${numberText(offer.quantity)} ${unit}</dd></div>
                <div><dt data-i18n="buyer.record.offerPrice">${escapeHTML(t("buyer.record.offerPrice"))}</dt><dd>LKR ${priceText(offer.offered_price)} / ${unit}</dd></div>
                <div><dt data-i18n="buyer.record.date">${escapeHTML(t("buyer.record.date"))}</dt><dd>${dateText(offer.created_at)}</dd></div>
            </dl>
        </article>`;
    }

    function orderCard(order) {
        const unit = escapeHTML(order.unit || "kg");
        const cancelAction = String(order.status).toLowerCase() === "pending"
            ? `<button class="bd-button bd-button-secondary bd-cancel-order" type="button" data-cancel-order="${escapeHTML(order.order_id)}" data-i18n="buyer.orders.cancel">${escapeHTML(t("buyer.orders.cancel"))}</button>`
            : "";
        return `<article class="bd-record-card" data-order-card="${escapeHTML(order.order_id)}">
            <div class="bd-record-heading"><div><p class="bd-record-kicker" data-i18n="buyer.record.orderNumber" data-i18n-param-id="${escapeHTML(order.order_id)}">${escapeHTML(t("buyer.record.orderNumber", { id: order.order_id }))}</p><h3>${escapeHTML(order.produce_name)}</h3></div>${statusMarkup(order.status)}</div>
            <dl class="bd-record-details">
                <div><dt data-i18n="buyer.record.farmer">${escapeHTML(t("buyer.record.farmer"))}</dt><dd>${escapeHTML(order.farmer_name)}</dd></div>
                <div><dt data-i18n="buyer.record.quantity">${escapeHTML(t("buyer.record.quantity"))}</dt><dd>${numberText(order.quantity)} ${unit}</dd></div>
                <div><dt data-i18n="buyer.record.total">${escapeHTML(t("buyer.record.total"))}</dt><dd>LKR ${priceText(order.total_amount)}</dd></div>
                <div><dt data-i18n="buyer.record.date">${escapeHTML(t("buyer.record.date"))}</dt><dd>${dateText(order.created_at)}</dd></div>
            </dl>${cancelAction}
        </article>`;
    }

    function emptyMarkup(titleKey, copyKey) {
        return `<div class="bd-empty-state bd-empty-compact"><h3 data-i18n="${titleKey}">${escapeHTML(t(titleKey))}</h3><p data-i18n="${copyKey}">${escapeHTML(t(copyKey))}</p></div>`;
    }

    function updateCount(id, sectionId, key, count, navId) {
        const value = String(count);
        animateMetric(id, count);
        const sectionCount = byId(sectionId);
        if (sectionCount) {
            sectionCount.textContent = t(key, { count: value });
            sectionCount.setAttribute("data-i18n", key);
            sectionCount.setAttribute("data-i18n-param-count", value);
        }
        const navCount = byId(navId);
        if (navCount) navCount.textContent = value;
    }

    function animateMetric(id, value) {
        const node = byId(id);
        if (!node) return;
        const target = Math.max(0, Number(value) || 0);
        const previous = Number(node.dataset.metricValue || 0);
        if (target === previous) {
            node.textContent = numberText(target);
            return;
        }
        node.dataset.metricValue = String(target);
        if (node.metricFrame) cancelAnimationFrame(node.metricFrame);
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion || typeof requestAnimationFrame !== "function") {
            node.textContent = numberText(target);
            return;
        }
        const started = performance.now();
        const draw = (now) => {
            const progress = Math.min(1, (now - started) / 680);
            const eased = 1 - Math.pow(1 - progress, 3);
            node.textContent = numberText(Math.round(previous + (target - previous) * eased));
            if (progress < 1) node.metricFrame = requestAnimationFrame(draw);
            else node.metricFrame = 0;
        };
        node.metricFrame = requestAnimationFrame(draw);
    }

    async function refreshOffers() {
        const response = await fetch("/api/my-offers", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
        });
        const result = await readResponse(response);
        if (!response.ok || !result.success || !Array.isArray(result.offers)) {
            throw new Error(t("buyer.error.offersRefresh"));
        }
        const container = byId("offersList");
        if (!container) return;
        if (document.body.dataset.pageView !== "offers") {
            container.innerHTML = result.offers.length
                ? result.offers.map(offerCard).join("")
                : emptyMarkup("buyer.offers.emptyTitle", "buyer.offers.emptyText");
        }
        updateCount("offersCount", "offersSectionCount", "buyer.offers.count", result.offers.length, "offersNavCount");
        const pendingCount = result.offers.filter((offer) => String(offer.status || "").toLowerCase() === "pending").length;
        const pendingMetric = byId("pendingOffersCount");
        if (pendingMetric) animateMetric("pendingOffersCount", pendingCount);
        if (document.body.dataset.pageView === "offers") {
            document.dispatchEvent(new CustomEvent("sf:listing-refresh"));
            return;
        }
        translate(container);
    }

    async function refreshOrders() {
        const response = await fetch("/api/my-orders", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
        });
        const result = await readResponse(response);
        if (!response.ok || !result.success || !Array.isArray(result.orders)) {
            throw new Error(t("buyer.error.ordersRefresh"));
        }
        const container = byId("ordersList");
        if (!container) return;
        if (document.body.dataset.pageView !== "orders") {
            container.innerHTML = result.orders.length
                ? result.orders.map(orderCard).join("")
                : emptyMarkup("buyer.orders.emptyTitle", "buyer.orders.emptyText");
        }
        updateCount("ordersCount", "ordersSectionCount", "buyer.orders.count", result.orders.length, "ordersNavCount");
        if (document.body.dataset.pageView === "orders") {
            document.dispatchEvent(new CustomEvent("sf:listing-refresh"));
            return;
        }
        translate(container);
    }

    function openOfferDialog(button) {
        if (!offerDialog || !offerForm) return;
        const quantityInput = byId("offerQuantity");
        const priceInput = byId("offerPrice");
        const produceId = button.dataset.produceId;
        const produceName = button.dataset.produceName || "";
        const unit = button.dataset.produceUnit || "kg";
        const maximum = Number(button.dataset.availableQuantity);
        selectedProduce = { produceId, produceName, unit, maximum };
        lastOfferTrigger = button;
        byId("offerProduceId").value = produceId;
        byId("offerProduceInfo").textContent = t("buyer.offerDialog.forProduce", { name: produceName });
        byId("offerQuantityHint").textContent = t("buyer.offerDialog.available", {
            quantity: numberText(maximum), unit
        });
        quantityInput.max = Number.isFinite(maximum) ? String(maximum) : "";
        quantityInput.value = "";
        priceInput.value = "";
        setFormMessage(byId("offerFormMessage"));
        offerDialog.showModal();
    }

    async function submitOffer(event) {
        event.preventDefault();
        if (!selectedProduce) return;
        const message = byId("offerFormMessage");
        const quantityInput = byId("offerQuantity");
        const priceInput = byId("offerPrice");
        const quantity = Number(quantityInput.value);
        const offeredPrice = Number(priceInput.value);
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(offeredPrice) || offeredPrice <= 0) {
            setFormMessage(message, "buyer.validation.positive");
            return;
        }
        if (quantity > selectedProduce.maximum) {
            setFormMessage(message, "buyer.validation.quantity");
            return;
        }

        const submitButton = byId("offerSubmit");
        submitButton.disabled = true;
        setFormMessage(message);
        try {
            const response = await fetch("/api/offers", {
                method: "POST",
                credentials: "same-origin",
                headers: mutationHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
                body: JSON.stringify({
                    produce_id: Number(selectedProduce.produceId),
                    quantity,
                    offered_price: offeredPrice
                })
            });
            const result = await readResponse(response);
            if (!response.ok || !result.success) {
                setFormMessage(message, response.status === 401 || response.status === 403
                    ? "buyer.error.session"
                    : "buyer.error.offerSubmit");
                return;
            }
            offerDialog.close();
            offerForm.reset();
            selectedProduce = null;
            showFeedback("buyer.success.offerSent");
            try {
                await refreshOffers();
            } catch (error) {
                showFeedback("buyer.error.offerRefreshAfterSubmit", "error");
            }
        } catch (error) {
            setFormMessage(message, "buyer.error.network");
        } finally {
            submitButton.disabled = false;
        }
    }

    async function cancelSelectedOrder() {
        if (!selectedOrder) return;
        const button = byId("confirmCancelOrder");
        const message = byId("cancelFormMessage");
        button.disabled = true;
        setFormMessage(message);
        try {
            const response = await fetch(`/api/orders/${encodeURIComponent(selectedOrder.orderId)}/status`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: mutationHeaders({ "Content-Type": "application/json", "Accept": "application/json" }),
                body: JSON.stringify({ status: "cancelled" })
            });
            const result = await readResponse(response);
            if (!response.ok || !result.success) {
                setFormMessage(message, response.status === 401 || response.status === 403
                    ? "buyer.error.session"
                    : response.status === 409 ? "buyer.error.orderConflict" : "buyer.error.orderCancel");
                return;
            }
            cancelDialog.close();
            showFeedback("buyer.success.orderCancelled");
            selectedOrder = null;
            try {
                await refreshOrders();
            } catch (error) {
                showFeedback("buyer.error.orderRefreshAfterCancel", "error");
            }
        } catch (error) {
            setFormMessage(message, "buyer.error.network");
        } finally {
            button.disabled = false;
        }
    }

    function initialiseSidebar() {
        if (!sidebar || !navToggle) return;
        const setOpen = (open) => {
            sidebar.classList.toggle("is-nav-open", open);
            navToggle.setAttribute("aria-expanded", String(open));
            const key = open ? "buyer.nav.close" : "buyer.nav.open";
            navToggle.setAttribute("data-i18n-aria-label", key);
            navToggle.setAttribute("aria-label", t(key));
        };
        navToggle.addEventListener("click", () => setOpen(navToggle.getAttribute("aria-expanded") !== "true"));
        document.querySelectorAll("[data-buyer-nav-link]").forEach((link) => {
            link.addEventListener("click", () => {
                document.querySelectorAll("[data-buyer-nav-link]").forEach((item) => {
                    item.classList.toggle("is-active", item === link);
                    if (item === link) item.setAttribute("aria-current", "page");
                    else item.removeAttribute("aria-current");
                });
                setOpen(false);
            });
        });
        document.addEventListener("click", (event) => {
            if (sidebar.classList.contains("is-nav-open") && !sidebar.contains(event.target)) setOpen(false);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") setOpen(false);
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 820) setOpen(false);
        });
    }

    function initialiseDialogs() {
        document.querySelectorAll("[data-offer-open]").forEach((button) => {
            button.addEventListener("click", () => openOfferDialog(button));
        });
        document.querySelectorAll("[data-close-offer]").forEach((button) => {
            button.addEventListener("click", () => offerDialog.close());
        });
        offerForm?.addEventListener("submit", submitOffer);
        offerDialog?.addEventListener("close", () => {
            selectedProduce = null;
            if (lastOfferTrigger?.isConnected) lastOfferTrigger.focus();
        });
        offerDialog?.addEventListener("click", (event) => {
            if (event.target === offerDialog) offerDialog.close();
        });

        document.addEventListener("click", (event) => {
            const trigger = event.target.closest("[data-cancel-order]");
            if (!trigger || !cancelDialog) return;
            selectedOrder = { orderId: trigger.dataset.cancelOrder };
            lastCancelTrigger = trigger;
            setFormMessage(byId("cancelFormMessage"));
            cancelDialog.showModal();
        });
        document.querySelectorAll("[data-close-cancel]").forEach((button) => {
            button.addEventListener("click", () => cancelDialog.close());
        });
        byId("confirmCancelOrder")?.addEventListener("click", cancelSelectedOrder);
        cancelDialog?.addEventListener("close", () => {
            selectedOrder = null;
            if (lastCancelTrigger?.isConnected) lastCancelTrigger.focus();
        });
        cancelDialog?.addEventListener("click", (event) => {
            if (event.target === cancelDialog) cancelDialog.close();
        });
    }

    ["produceCount", "offersCount", "pendingOffersCount", "ordersCount"].forEach((id) => {
        const node = byId(id);
        if (node) animateMetric(id, node.textContent);
    });
    initialiseSidebar();
    initialiseDialogs();
    initialiseProduceSearch();
})();
