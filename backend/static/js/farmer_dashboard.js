(() => {
    "use strict";

    const byId = (id) => document.getElementById(id);
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const mutationHeaders = (headers = {}) => ({ ...headers, "X-CSRFToken": csrfToken });
    const produceForm = byId("produceForm");
    const editForm = byId("editProduceForm");
    const editDialog = byId("editProduceDialog");
    const formMessage = byId("formMessage");
    const editFormMessage = byId("editFormMessage");
    const saveButton = byId("saveButton");
    const produceContainer = byId("myProduce");
    const offersContainer = byId("receivedOffers");
    const ordersContainer = byId("farmerOrders");
    const sidebar = byId("farmerSidebar");
    const navToggle = document.querySelector("[data-farmer-nav-toggle]");

    if (!produceForm || !produceContainer || !offersContainer || !ordersContainer) {
        // The profile page shares the Farmer sidebar but does not load dashboard data.
        if (sidebar && navToggle) {
            const setProfileNavOpen = (open) => {
                sidebar.classList.toggle("is-nav-open", open);
                navToggle.setAttribute("aria-expanded", String(open));
                const key = open ? "farmer.nav.close" : "farmer.nav.open";
                navToggle.setAttribute("data-i18n-aria-label", key);
                navToggle.setAttribute(
                    "aria-label",
                    window.SmartFarmerI18n?.translateKey(key, document.documentElement.lang || "en") || key
                );
            };
            navToggle.addEventListener("click", () => {
                setProfileNavOpen(navToggle.getAttribute("aria-expanded") !== "true");
            });
            document.querySelectorAll("[data-profile-nav-link]").forEach((link) => {
                link.addEventListener("click", () => setProfileNavOpen(false));
            });
            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") setProfileNavOpen(false);
            });
            document.addEventListener("click", (event) => {
                if (sidebar.classList.contains("is-nav-open") && !sidebar.contains(event.target)) {
                    setProfileNavOpen(false);
                }
            });
            window.addEventListener("resize", () => {
                if (window.innerWidth > 820) setProfileNavOpen(false);
            });
        }
        return;
    }

    let produceData = [];
    let totalProduceCount = 0;
    let activeProduceCount = 0;
    let activeProduceCategory = "all";
    let showAllProduce = document.body.dataset.pageView === "produce";
    const dedicatedTableView = ["offers", "orders"].includes(document.body.dataset.pageView);
    let offerData = [];
    let orderData = [];
    let editingProduce = null;
    let lastEditTrigger = null;

    const produceCategoryFilter = window.SmartFarmerProduceImages?.mountCategoryFilter(
        byId("farmerProduceCategoryFilter"),
        (category) => {
            activeProduceCategory = category;
            renderProduce();
        }
    );
    activeProduceCategory = produceCategoryFilter?.getActive() || "all";

    const t = (key, values = {}) => {
        const translated = window.SmartFarmerI18n?.translateKey(
            key,
            document.documentElement.lang || "en"
        ) || key;
        return translated.replace(/\{([a-z][a-z0-9_-]*)\}/gi, (match, name) =>
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
        );
    };

    function applyTranslations(root = document) {
        window.SmartFarmerI18n?.apply(document.documentElement.lang || "en", root);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function translatedNode(tag, className, key, values) {
        const node = el(tag, className, t(key, values));
        node.setAttribute("data-i18n", key);
        if (values) {
            Object.entries(values).forEach(([name, value]) => {
                node.setAttribute(`data-i18n-param-${name}`, String(value));
            });
        }
        return node;
    }

    function showMessage(container, key, kind) {
        if (!container) return;
        container.textContent = t(key);
        container.setAttribute("data-i18n", key);
        container.classList.add("is-visible");
        container.classList.toggle("is-success", kind === "success");
        container.classList.toggle("is-error", kind === "error");
    }

    function hideMessage(container) {
        if (!container) return;
        container.textContent = "";
        container.removeAttribute("data-i18n");
        container.classList.remove("is-visible", "is-success", "is-error");
    }

    function setCount(id, value, key) {
        const node = byId(id);
        if (!node) return;
        node.textContent = t(key, { count: value });
        node.setAttribute("data-i18n", key);
        node.setAttribute("data-i18n-param-count", String(value));
    }

    function animateMetric(id, value) {
        const node = byId(id);
        if (!node) return;
        const target = Math.max(0, Number(value) || 0);
        const previous = Number(node.dataset.metricValue || 0);
        if (target === previous) {
            node.textContent = target.toLocaleString(document.documentElement.lang || "en");
            return;
        }
        node.dataset.metricValue = String(target);
        if (node.metricFrame) cancelAnimationFrame(node.metricFrame);
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion || typeof requestAnimationFrame !== "function") {
            node.textContent = target.toLocaleString(document.documentElement.lang || "en");
            return;
        }
        const start = performance.now();
        const duration = 680;
        const draw = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(previous + (target - previous) * eased);
            node.textContent = current.toLocaleString(document.documentElement.lang || "en");
            if (progress < 1) node.metricFrame = requestAnimationFrame(draw);
            else node.metricFrame = 0;
        };
        node.metricFrame = requestAnimationFrame(draw);
    }

    function updateStatistics() {
        animateMetric("totalProduceCount", totalProduceCount);
        animateMetric("produceCount", activeProduceCount);
        animateMetric("offerCount", offerData.length);
        animateMetric("orderCount", orderData.length);
        [
            ["produceNavCount", totalProduceCount],
            ["offersNavCount", offerData.length],
            ["ordersNavCount", orderData.length]
        ].forEach(([id, value]) => {
            const badge = byId(id);
            if (badge) badge.textContent = Math.max(0, Number(value) || 0).toLocaleString(document.documentElement.lang || "en");
        });
        setCount("produceTotalBadge", totalProduceCount, "farmer.produce.count");
        setCount("produceBadge", activeProduceCount, "farmer.produce.count");
        setCount("produceSectionCount", showAllProduce ? totalProduceCount : activeProduceCount, "farmer.produce.count");
        setCount("offerBadge", offerData.length, "farmer.offers.count");
        setCount("offerSectionCount", offerData.length, "farmer.offers.count");
        setCount("orderBadge", orderData.length, "farmer.orders.count");
        setCount("orderSectionCount", orderData.length, "farmer.orders.count");
    }

    function showEmpty(container, titleKey, copyKey) {
        container.replaceChildren();
        const empty = el("div", "fd-empty-state");
        if (titleKey) empty.appendChild(translatedNode("strong", "", titleKey));
        if (copyKey) empty.appendChild(translatedNode("span", "", copyKey));
        container.appendChild(empty);
        applyTranslations(empty);
    }

    function responseError(response, result, fallbackKey) {
        const message = String(result?.message || "");
        if (response.status === 401 || response.status === 403 || /log in|session/i.test(message)) {
            return "farmer.error.session";
        }
        if (/not enough stock/i.test(message)) return "farmer.error.insufficientStock";
        if (/already been processed|not found|do not own/i.test(message)) {
            return fallbackKey === "farmer.error.offerUpdate"
                ? "farmer.error.offerUpdate"
                : fallbackKey;
        }
        if (/valid quantity and price|must be greater than zero|positive/i.test(message)) {
            return "farmer.form.validation.positive";
        }
        if (/name and district|required/i.test(message)) return "farmer.form.validation.nameDistrict";
        if (/already available|not available/i.test(message)) return fallbackKey;
        return fallbackKey;
    }

    async function readJson(response) {
        try {
            return await response.json();
        } catch (error) {
            return { success: false };
        }
    }

    function validateForm(form, { nameId, quantityId, priceId, districtId }) {
        const requiredFields = Array.from(form.querySelectorAll("[required]"));
        requiredFields.forEach((field) => field.setCustomValidity(""));
        const missing = requiredFields.find((field) => !String(field.value || "").trim());
        if (missing) {
            missing.setCustomValidity(t("farmer.form.validation.required"));
            missing.reportValidity();
            return false;
        }
        if (nameId && !byId(nameId).value.trim()) {
            byId(nameId).setCustomValidity(t("farmer.form.validation.nameDistrict"));
            byId(nameId).reportValidity();
            return false;
        }
        if (districtId && !byId(districtId).value) {
            byId(districtId).setCustomValidity(t("farmer.form.validation.nameDistrict"));
            byId(districtId).reportValidity();
            return false;
        }
        if (quantityId && priceId && (Number(byId(quantityId).value) <= 0 || Number(byId(priceId).value) <= 0)) {
            const invalidField = Number(byId(quantityId).value) <= 0 ? byId(quantityId) : byId(priceId);
            invalidField.setCustomValidity(t("farmer.form.validation.positive"));
            invalidField.reportValidity();
            return false;
        }
        return true;
    }

    document.querySelectorAll(".sf-farmer-dashboard [required]").forEach((field) => {
        field.addEventListener("input", () => field.setCustomValidity(""));
        field.addEventListener("change", () => field.setCustomValidity(""));
    });

    async function loadMyProduce() {
        try {
            const query = showAllProduce ? "?include_unavailable=1" : "";
            const response = await fetch(`/api/my-produce${query}`, { credentials: "same-origin" });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                produceData = [];
                totalProduceCount = 0;
                activeProduceCount = 0;
                updateStatistics();
                if (!dedicatedTableView) showEmpty(produceContainer, null, responseError(response, result, "farmer.error.loadProduce"));
                return false;
            }
            produceData = result.produce || [];
            totalProduceCount = Number.isFinite(Number(result.total_count))
                ? Number(result.total_count)
                : produceData.length;
            activeProduceCount = Number.isFinite(Number(result.active_count))
                ? Number(result.active_count)
                : produceData.length;
            updateStatistics();
            if (dedicatedTableView) return true;
            if (!produceData.length) {
                if (!showAllProduce && totalProduceCount > 0) {
                    showEmpty(produceContainer, "farmer.produce.noActiveTitle", "farmer.produce.noActiveCopy");
                } else {
                    showEmpty(produceContainer, "farmer.produce.empty.title", "farmer.produce.empty.copy");
                }
                return true;
            }
            renderProduce();
            return true;
        } catch (error) {
            console.warn("Farmer produce request failed.", error);
            produceData = [];
            totalProduceCount = 0;
            activeProduceCount = 0;
            updateStatistics();
            if (!dedicatedTableView) showEmpty(produceContainer, null, "farmer.error.network");
            return false;
        }
    }

    function renderProduce() {
        produceContainer.replaceChildren();
        const query = normalizeProduceName(byId("farmerProduceSearch")?.value || "");
        const visibleProduce = produceData.filter((item) =>
            normalizeProduceName(item.produce_name).includes(query)
            && (activeProduceCategory === "all" || window.SmartFarmerProduceImages?.classify(
                item.produce_name,
                item.category_name || item.category
            ) === activeProduceCategory)
        );
        if (!visibleProduce.length) {
            showEmpty(produceContainer, "farmer.search.noMatchesTitle", "farmer.search.noMatchesCopy");
            return;
        }
        visibleProduce.forEach((item) => {
            const card = el("article", "fd-data-card fd-produce-listing-card");
            const photo = el("img", "fd-produce-photo");
            photo.dataset.produceImage = "true";
            photo.dataset.produceName = String(item.produce_name || "");
            photo.dataset.produceCategory = String(item.category_name || item.category || "");
            photo.alt = `Fresh ${String(item.produce_name || "produce")}`;
            photo.loading = "lazy";
            photo.decoding = "async";
            const head = el("div", "fd-card-head");
            const titleGroup = el("div");
            const isAvailable = item.available === undefined ? true : Number(item.available) === 1;
            titleGroup.append(
                translatedNode("p", "fd-card-kicker", isAvailable ? "farmer.produce.available" : "farmer.produce.unavailable"),
                el("h3", "", item.produce_name)
            );
            const actions = el("div", "fd-card-actions");
            actions.append(
                actionButton("farmer.action.edit", "fd-button fd-button-secondary", () => openEdit(item)),
                actionButton("farmer.action.delete", "fd-button fd-button-danger", () => deleteProduce(item.produce_id))
            );
            head.append(titleGroup);
            card.append(photo, head);
            const price = el("p", "fd-card-price", `LKR ${item.price_per_unit} / ${item.unit}`);
            card.append(price);
            const details = el("dl", "fd-card-details");
            details.append(
                detail("farmer.field.quantity", `${item.quantity} ${item.unit}`),
                detail("farmer.produce.district", item.district)
            );
            card.append(details, el("p", "fd-card-description", item.description || t("farmer.produce.noDescription")), actions);
            if (!item.description) card.lastElementChild.previousElementSibling.setAttribute("data-i18n", "farmer.produce.noDescription");
            produceContainer.appendChild(card);
        });
        applyTranslations(produceContainer);
    }

    function normalizeProduceName(value) {
        return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    }

    function updateProduceViewToggle() {
        const link = document.querySelector("[data-produce-view-toggle]");
        const label = link?.querySelector("[data-i18n]");
        if (link && label) {
            const key = showAllProduce ? "farmer.produce.showActiveOnly" : "farmer.produce.viewAll";
            label.setAttribute("data-i18n", key);
            label.textContent = t(key);
            link.setAttribute("aria-expanded", String(showAllProduce));
        }
        const eyebrow = byId("produceSectionEyebrow");
        if (eyebrow) {
            const eyebrowKey = showAllProduce ? "farmer.produce.allEyebrow" : "farmer.produce.eyebrow";
            eyebrow.setAttribute("data-i18n", eyebrowKey);
            eyebrow.textContent = t(eyebrowKey);
        }
    }

    function initialiseProduceControls() {
        const search = byId("farmerProduceSearch");
        const clear = byId("farmerProduceSearchClear");
        const viewToggle = document.querySelector("[data-produce-view-toggle]");
        search?.addEventListener("input", () => {
            if (clear) clear.disabled = !search.value;
            if (produceData.length) renderProduce();
        });
        clear?.addEventListener("click", () => {
            if (!search) return;
            search.value = "";
            clear.disabled = true;
            if (produceData.length) renderProduce();
            search.focus();
        });
        viewToggle?.addEventListener("click", async (event) => {
            event.preventDefault();
            const previous = showAllProduce;
            const previousProduce = produceData;
            const previousTotal = totalProduceCount;
            const previousActive = activeProduceCount;
            showAllProduce = !showAllProduce;
            updateProduceViewToggle();
            if (!await loadMyProduce()) {
                showAllProduce = previous;
                produceData = previousProduce;
                totalProduceCount = previousTotal;
                activeProduceCount = previousActive;
                updateProduceViewToggle();
                updateStatistics();
                if (produceData.length) renderProduce();
            }
        });
        updateProduceViewToggle();
        if (clear) clear.disabled = !search?.value;
    }

    function detail(labelKey, value) {
        const row = el("div");
        row.append(translatedNode("dt", "", labelKey), el("dd", "", value ?? "—"));
        return row;
    }

    function actionButton(key, className, handler) {
        const button = el("button", className, t(key));
        button.type = "button";
        button.setAttribute("data-i18n", key);
        button.addEventListener("click", handler);
        return button;
    }

    function openEdit(item, trigger) {
        editingProduce = item;
        lastEditTrigger = trigger || document.activeElement;
        hideMessage(editFormMessage);
        byId("edit_produce_name").value = item.produce_name || "";
        byId("edit_quantity").value = item.quantity ?? "";
        byId("edit_price_per_unit").value = item.price_per_unit ?? "";
        byId("edit_district").value = item.district || "";
        byId("edit_description").value = item.description || "";
        if (typeof editDialog.showModal === "function") editDialog.showModal();
        else editDialog.setAttribute("open", "");
        byId("edit_produce_name").focus();
    }

    function closeEdit() {
        if (typeof editDialog.close === "function" && editDialog.open) editDialog.close();
        else editDialog.removeAttribute("open");
        editingProduce = null;
        if (lastEditTrigger?.isConnected) lastEditTrigger.focus();
    }

    async function saveProduce(event) {
        event.preventDefault();
        hideMessage(formMessage);
        if (!validateForm(produceForm, {
            nameId: "produce_name", quantityId: "quantity", priceId: "price_per_unit", districtId: "district"
        })) return;

        saveButton.disabled = true;
        const saveLabel = saveButton.querySelector("[data-i18n]");
        if (saveLabel) saveLabel.textContent = t("farmer.form.saving");
        const formData = new FormData(produceForm);
        const payload = {
            produce_name: formData.get("produce_name"),
            quantity: formData.get("quantity"),
            unit: formData.get("unit"),
            price_per_unit: formData.get("price_per_unit"),
            district: formData.get("district"),
            description: formData.get("description")
        };

        try {
            const response = await fetch("/api/produce", {
                method: "POST",
                credentials: "same-origin",
                headers: mutationHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify(payload)
            });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                showMessage(formMessage, responseError(response, result, "farmer.error.saveProduce"), "error");
                return;
            }
            showMessage(formMessage, "farmer.form.saved", "success");
            produceForm.reset();
            await loadMyProduce();
        } catch (error) {
            console.warn("Farmer produce save failed.", error);
            showMessage(formMessage, "farmer.error.network", "error");
        } finally {
            saveButton.disabled = false;
            if (saveLabel) saveLabel.textContent = t("farmer.form.save");
        }
    }

    async function saveEdit(event) {
        event.preventDefault();
        hideMessage(editFormMessage);
        if (!editingProduce || !validateForm(editForm, {
            nameId: "edit_produce_name", quantityId: "edit_quantity", priceId: "edit_price_per_unit", districtId: "edit_district"
        })) return;

        const button = byId("editSaveButton");
        button.disabled = true;
        button.textContent = t("farmer.action.saving");
        const formData = new FormData(editForm);
        const payload = {
            produce_name: String(formData.get("produce_name") || "").trim(),
            quantity: formData.get("quantity"),
            price_per_unit: formData.get("price_per_unit"),
            district: String(formData.get("district") || "").trim(),
            description: String(formData.get("description") || "").trim(),
            unit: editingProduce.unit
        };
        try {
            const response = await fetch(`/api/produce/${editingProduce.produce_id}`, {
                method: "PUT",
                credentials: "same-origin",
                headers: mutationHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify(payload)
            });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                showMessage(editFormMessage, responseError(response, result, "farmer.error.updateProduce"), "error");
                return;
            }
            closeEdit();
            await loadMyProduce();
            showMessage(formMessage, "farmer.action.editSuccess", "success");
        } catch (error) {
            console.warn("Farmer produce update failed.", error);
            showMessage(editFormMessage, "farmer.error.network", "error");
        } finally {
            button.disabled = false;
            button.textContent = t("farmer.action.save");
        }
    }

    async function deleteProduce(produceId) {
        if (!window.confirm(t("farmer.action.deleteConfirm"))) return;
        try {
            const response = await fetch(`/api/produce/${produceId}`, {
                method: "DELETE",
                credentials: "same-origin",
                headers: mutationHeaders()
            });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                showMessage(formMessage, responseError(response, result, "farmer.error.deleteProduce"), "error");
                return;
            }
            await loadMyProduce();
            showMessage(formMessage, "farmer.action.deleteSuccess", "success");
        } catch (error) {
            console.warn("Farmer produce delete failed.", error);
            showMessage(formMessage, "farmer.error.network", "error");
        }
    }

    async function loadReceivedOffers() {
        try {
            const response = await fetch("/api/received-offers", { credentials: "same-origin" });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                offerData = [];
                updateStatistics();
                if (!dedicatedTableView) showEmpty(offersContainer, null, responseError(response, result, "farmer.error.loadOffers"));
                return;
            }
            offerData = result.offers || [];
            updateStatistics();
            if (dedicatedTableView) return;
            if (!offerData.length) {
                showEmpty(offersContainer, "farmer.offers.empty.title", "farmer.offers.empty.copy");
                return;
            }
            renderOffers();
        } catch (error) {
            console.warn("Farmer offers request failed.", error);
            offerData = [];
            updateStatistics();
            if (!dedicatedTableView) showEmpty(offersContainer, null, "farmer.error.network");
        }
    }

    function renderOffers() {
        offersContainer.replaceChildren();
        offerData.forEach((offer) => {
            const card = el("article", "fd-data-card");
            const head = el("div", "fd-card-head");
            const title = el("h3", "", offer.produce_name);
            const status = statusBadge(offer.status);
            head.append(title, status);
            const details = el("dl", "fd-card-details");
            details.append(
                detail("farmer.offer.buyer", offer.buyer_name),
                detail("farmer.offer.quantity", `${offer.quantity} ${offer.unit}`),
                detail("farmer.offer.district", offer.district || "—")
            );
            const price = el("p", "fd-card-price", `LKR ${offer.offered_price} / ${offer.unit}`);
            const priceLabel = translatedNode("span", "fd-card-kicker", "farmer.offer.price");
            const actions = el("div", "fd-card-actions");
            if (offer.status === "pending") {
                actions.append(
                    actionButton("farmer.offer.accept", "fd-button fd-button-primary", () => updateOfferStatus(offer.offer_id, "accepted")),
                    actionButton("farmer.offer.reject", "fd-button fd-button-danger", () => updateOfferStatus(offer.offer_id, "rejected"))
                );
            }
            card.append(head, details, priceLabel, price);
            if (actions.childElementCount) card.appendChild(actions);
            offersContainer.appendChild(card);
        });
        applyTranslations(offersContainer);
    }

    function statusKey(status) {
        const normalized = String(status || "").toLowerCase();
        return `farmer.status.${normalized}`;
    }

    function statusBadge(status) {
        const normalized = String(status || "unknown").toLowerCase();
        const badge = el("span", `fd-status fd-status-${normalized}`, t(statusKey(normalized)));
        badge.setAttribute("data-i18n", statusKey(normalized));
        if (badge.textContent === statusKey(normalized)) badge.textContent = normalized;
        return badge;
    }

    async function updateOfferStatus(offerId, status) {
        const confirmationKey = status === "accepted" ? "farmer.offer.acceptConfirm" : "farmer.offer.rejectConfirm";
        if (!window.confirm(t(confirmationKey))) return;
        try {
            const response = await fetch(`/api/offers/${offerId}/status`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: mutationHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ status })
            });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                showMessage(formMessage, responseError(response, result, "farmer.error.offerUpdate"), "error");
                return;
            }
            await loadReceivedOffers();
            if (status === "accepted") {
                await Promise.all([loadMyProduce(), loadFarmerOrders()]);
                showMessage(formMessage, "farmer.offer.accepted", "success");
            } else {
                showMessage(formMessage, "farmer.offer.rejected", "success");
            }
        } catch (error) {
            console.warn("Farmer offer update failed.", error);
            showMessage(formMessage, "farmer.error.network", "error");
        }
    }

    async function loadFarmerOrders() {
        try {
            const response = await fetch("/api/farmer/orders", { credentials: "same-origin" });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                orderData = [];
                updateStatistics();
                if (!dedicatedTableView) showEmpty(ordersContainer, null, responseError(response, result, "farmer.error.loadOrders"));
                return;
            }
            orderData = result.orders || [];
            updateStatistics();
            if (dedicatedTableView) return;
            if (!orderData.length) {
                showEmpty(ordersContainer, "farmer.orders.empty.title", "farmer.orders.empty.copy");
                return;
            }
            renderOrders();
        } catch (error) {
            console.warn("Farmer orders request failed.", error);
            orderData = [];
            updateStatistics();
            if (!dedicatedTableView) showEmpty(ordersContainer, null, "farmer.error.network");
        }
    }

    function renderOrders() {
        ordersContainer.replaceChildren();
        orderData.forEach((order) => {
            const card = el("article", "fd-order-card");
            const head = el("div", "fd-order-head");
            const number = el("span", "fd-order-number", `#${order.order_id}`);
            const status = statusBadge(order.status);
            head.append(number, status);
            const details = el("dl", "fd-order-details");
            details.append(
                detail("farmer.order.produce", order.produce_name),
                detail("farmer.order.buyer", order.buyer_name),
                detail("farmer.order.quantity", `${order.quantity} ${order.unit || ""}`),
                detail("farmer.order.total", `LKR ${Number(order.total_amount).toFixed(2)}`)
            );
            const actions = el("div", "fd-order-actions");
            if (order.status === "pending") {
                actions.append(
                    actionButton("farmer.order.confirm", "fd-button fd-button-primary", () => updateOrderStatus(order.order_id, "confirmed")),
                    actionButton("farmer.order.cancel", "fd-button fd-button-danger", () => updateOrderStatus(order.order_id, "cancelled"))
                );
            } else if (order.status === "confirmed") {
                actions.append(
                    actionButton("farmer.order.complete", "fd-button fd-button-primary", () => updateOrderStatus(order.order_id, "completed")),
                    actionButton("farmer.order.cancel", "fd-button fd-button-danger", () => updateOrderStatus(order.order_id, "cancelled"))
                );
            } else {
                actions.appendChild(translatedNode("span", "fd-card-kicker", "farmer.order.noActions"));
            }
            card.append(head, details, actions);
            ordersContainer.appendChild(card);
        });
        applyTranslations(ordersContainer);
    }

    async function updateOrderStatus(orderId, status) {
        const promptKey = {
            confirmed: "farmer.order.confirmPrompt",
            completed: "farmer.order.completePrompt",
            cancelled: "farmer.order.cancelPrompt"
        }[status];
        if (!window.confirm(t(promptKey))) return;
        try {
            const response = await fetch(`/api/orders/${orderId}/status`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: mutationHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ status })
            });
            const result = await readJson(response);
            if (!response.ok || !result.success) {
                showMessage(formMessage, responseError(response, result, "farmer.error.orderUpdate"), "error");
                return;
            }
            await loadFarmerOrders();
            if (status === "cancelled") await loadMyProduce();
            showMessage(formMessage, "farmer.order.updated", "success");
        } catch (error) {
            console.warn("Farmer order update failed.", error);
            showMessage(formMessage, "farmer.error.network", "error");
        }
    }

    function initialiseNavigation() {
        if (!navToggle || !sidebar) return;
        const links = document.querySelectorAll("[data-dashboard-link]");
        const setOpen = (open) => {
            sidebar.classList.toggle("is-nav-open", open);
            navToggle.setAttribute("aria-expanded", String(open));
            const key = open ? "farmer.nav.close" : "farmer.nav.open";
            navToggle.setAttribute("data-i18n-aria-label", key);
            navToggle.setAttribute("aria-label", t(key));
        };
        navToggle.addEventListener("click", () => setOpen(navToggle.getAttribute("aria-expanded") !== "true"));
        links.forEach((link) => link.addEventListener("click", () => {
            links.forEach((item) => {
                item.classList.toggle("is-active", item === link);
                if (item === link) item.setAttribute("aria-current", "page");
                else item.removeAttribute("aria-current");
            });
            setOpen(false);
        }));
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") setOpen(false);
        });
        document.addEventListener("click", (event) => {
            if (sidebar.classList.contains("is-nav-open") && !sidebar.contains(event.target)) setOpen(false);
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 820) setOpen(false);
        });
    }

    function initialiseEditDialog() {
        editForm?.addEventListener("submit", saveEdit);
        document.querySelectorAll("[data-edit-close]").forEach((button) => button.addEventListener("click", closeEdit));
        editDialog?.addEventListener("click", (event) => {
            if (event.target === editDialog) closeEdit();
        });
        editDialog?.addEventListener("close", () => {
            editingProduce = null;
            if (lastEditTrigger?.isConnected) lastEditTrigger.focus();
        });
    }

    function initialiseLanguageRefresh() {
        if (!window.MutationObserver) return;
        const observer = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.attributeName === "lang")) updateStatistics();
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }

    produceForm.addEventListener("submit", saveProduce);
    initialiseNavigation();
    initialiseEditDialog();
    initialiseLanguageRefresh();
    initialiseProduceControls();
    updateStatistics();
    Promise.all([loadMyProduce(), loadReceivedOffers(), loadFarmerOrders()]);
})();
