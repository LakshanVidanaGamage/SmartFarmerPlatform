(() => {
    "use strict";

    const form = document.getElementById("produce-filter-form");
    const searchInput = document.getElementById("produce-search");
    const districtSelect = document.getElementById("produce-district");
    const clearButton = document.getElementById("clear-produce-filters");
    const resultCount = document.getElementById("produce-result-count");
    const grid = document.getElementById("public-produce-grid");

    if (!form || !searchInput || !districtSelect || !resultCount || !grid) return;

    let produce = [];
    let appliedSearch = "";
    let appliedDistrict = "";
    let appliedCategory = "all";

    const categoryFilter = window.SmartFarmerProduceImages?.mountCategoryFilter(
        document.getElementById("publicProduceCategoryFilter"),
        (category) => {
            appliedCategory = category;
            render();
        }
    );

    function translate(key) {
        return window.SmartFarmerI18n?.translateKey(key)
            || window.SmartFarmerI18n?.getMessages?.()[document.documentElement.lang]?.[key]
            || key;
    }

    function localizedCount(count) {
        return translate("produce.resultCount").replace("{count}", String(count));
    }

    function setText(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
    }

    function addLocationIcon(parent) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        const pin = document.createElementNS(svg.namespaceURI, "path");
        pin.setAttribute("d", "M8 14s5-5 5-8a5 5 0 0 0-10 0c0 3 5 8 5 8Z");
        const center = document.createElementNS(svg.namespaceURI, "circle");
        center.setAttribute("cx", "8");
        center.setAttribute("cy", "6");
        center.setAttribute("r", "1.5");
        svg.append(pin, center);
        parent.appendChild(svg);
    }

    function makeCard(item, index) {
        const card = document.createElement("article");
        card.className = "sf-produce-card";
        card.dataset.produceCategoryId = window.SmartFarmerProduceImages?.classify(
            item.produce_name,
            item.category_name || item.category
        ) || "other_crops";

        const art = document.createElement("div");
        art.className = `sf-product-art sf-product-art-${(index % 3) + 1}`;
        const photo = document.createElement("img");
        photo.className = "sf-product-photo";
        photo.dataset.produceImage = "true";
        photo.dataset.produceName = String(item.produce_name || "");
        photo.dataset.produceCategory = String(item.category_name || item.category || "");
        photo.alt = `Fresh ${String(item.produce_name || "produce")}`;
        photo.loading = "lazy";
        photo.decoding = "async";
        art.appendChild(photo);
        art.appendChild(setText("span", "sf-art-tag", translate("home.produce.local")));

        const content = document.createElement("div");
        content.className = "sf-product-content";

        const topline = document.createElement("div");
        topline.className = "sf-product-topline";
        const location = document.createElement("span");
        location.className = "sf-product-location";
        addLocationIcon(location);
        location.appendChild(document.createTextNode(String(item.district || translate("produce.locationUnavailable"))));
        const availability = document.createElement("span");
        availability.className = "sf-availability";
        const availabilityDot = document.createElement("i");
        availabilityDot.setAttribute("aria-hidden", "true");
        availability.append(availabilityDot, document.createTextNode(translate("home.produce.available")));
        topline.append(location, availability);

        const name = setText("h3", "", String(item.produce_name || ""));
        const description = setText(
            "p",
            "sf-product-description",
            String(item.description || translate("produce.defaultDescription")),
        );

        const bottom = document.createElement("div");
        bottom.className = "sf-product-bottom";
        const amount = Number(item.price_per_unit);
        const price = document.createElement("div");
        price.className = "sf-product-price";
        price.appendChild(document.createTextNode(Number.isFinite(amount) ? `Rs. ${amount.toFixed(2)}` : "—"));
        price.appendChild(setText("small", "", ` / ${String(item.unit || "kg")}`));
        const availableQuantity = Number(item.quantity);
        const quantity = document.createElement("span");
        quantity.className = "sf-product-quantity";
        const quantityLabel = Number.isFinite(availableQuantity)
            ? `${availableQuantity.toLocaleString(document.documentElement.lang, { maximumFractionDigits: 2 })} ${String(item.unit || "kg")}`
            : "—";
        quantity.append(
            document.createTextNode(`${quantityLabel} `),
            document.createTextNode(translate("home.produce.quantityAvailable")),
        );
        bottom.append(price, quantity);

        content.append(topline, name, description, bottom);
        const farmerId = Number(item.farmer_id);
        if (Number.isSafeInteger(farmerId) && farmerId > 0) {
            const farmerLink = document.createElement("a");
            farmerLink.className = "sf-farmer-link";
            farmerLink.href = `/farmers/${farmerId}`;
            farmerLink.append(
                setText("span", "", translate("home.produce.meetFarmer")),
                setText("span", "", "→"),
            );
            farmerLink.lastElementChild.setAttribute("aria-hidden", "true");
            content.appendChild(farmerLink);
        }

        card.append(art, content);
        return card;
    }

    function renderEmptyState() {
        const empty = document.createElement("div");
        empty.className = "sf-empty-state";
        empty.append(
            setText("h3", "", translate("produce.emptyTitle")),
            setText("p", "", translate("produce.emptyCopy")),
        );
        grid.appendChild(empty);
    }

    function render() {
        const query = appliedSearch.toLocaleLowerCase(document.documentElement.lang || "en");
        const matches = produce.filter((item) => {
            const name = String(item.produce_name || "").toLocaleLowerCase(document.documentElement.lang || "en");
            const category = window.SmartFarmerProduceImages?.classify(
                item.produce_name,
                item.category_name || item.category
            ) || "other_crops";
            return (!query || name.includes(query))
                && (!appliedDistrict || String(item.district || "") === appliedDistrict)
                && (appliedCategory === "all" || category === appliedCategory);
        });

        resultCount.textContent = localizedCount(matches.length);
        grid.replaceChildren();
        if (!matches.length) {
            renderEmptyState();
            return;
        }
        matches.forEach((item, index) => grid.appendChild(makeCard(item, index)));
    }

    function populateDistricts() {
        const currentValue = districtSelect.value;
        const districts = [...new Set(produce.map((item) => String(item.district || "").trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, document.documentElement.lang || "en"));
        districtSelect.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
        districts.forEach((district) => {
            const option = document.createElement("option");
            option.value = district;
            option.textContent = district;
            districtSelect.appendChild(option);
        });
        if (districts.includes(currentValue)) districtSelect.value = currentValue;
    }

    async function loadProduce() {
        grid.setAttribute("aria-busy", "true");
        try {
            const response = await fetch("/api/produce", {
                method: "GET",
                headers: { Accept: "application/json" },
                credentials: "same-origin",
            });
            const result = await response.json();
            if (!response.ok || result.success !== true || !Array.isArray(result.produce)) {
                throw new Error("produce-load-failed");
            }
            produce = result.produce;
            populateDistricts();
            render();
        } catch (_) {
            resultCount.textContent = translate("produce.loadError");
            grid.replaceChildren();
        } finally {
            grid.removeAttribute("aria-busy");
        }
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        appliedSearch = searchInput.value.trim();
        appliedDistrict = districtSelect.value;
        render();
    });
    clearButton?.addEventListener("click", () => {
        searchInput.value = "";
        districtSelect.value = "";
        appliedSearch = "";
        appliedDistrict = "";
        appliedCategory = "all";
        if (categoryFilter?.setActive) {
            categoryFilter.setActive("all");
        }
        render();
    });
    document.addEventListener("sf:languagechange", () => {
        if (produce.length) {
            populateDistricts();
            render();
        } else if (grid.getAttribute("aria-busy") === "true") {
            resultCount.textContent = translate("produce.loading");
        }
    });

    loadProduce();
})();
