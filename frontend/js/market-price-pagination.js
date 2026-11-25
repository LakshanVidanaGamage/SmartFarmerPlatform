(() => {
    "use strict";

    const perPage = 6;
    const translate = (key, values = {}) => {
        let message = window.SmartFarmerI18n?.translateKey(
            key,
            document.documentElement.lang || "en"
        ) || key;
        Object.entries(values).forEach(([name, value]) => {
            message = message.replaceAll(`{${name}}`, String(value));
        });
        return message;
    };

    function createCard(record) {
        const card = document.createElement("article");
        card.className = "sf-market-price-card";

        const media = document.createElement("div");
        media.className = "sf-market-price-media";
        const image = document.createElement("img");
        image.dataset.produceImage = "";
        image.dataset.produceImageFallback = "mixed";
        image.dataset.produceName = record.produce_name || "Produce";
        image.alt = image.dataset.produceName;
        image.loading = "lazy";
        image.decoding = "async";
        media.append(image);

        const body = document.createElement("div");
        body.className = "sf-market-price-body";
        const heading = document.createElement("h3");
        heading.textContent = record.produce_name || "Produce";
        const amount = document.createElement("p");
        amount.className = "sf-market-price-amount";
        const value = document.createElement("strong");
        value.textContent = new Intl.NumberFormat(
            document.documentElement.lang || "en",
            { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        ).format(Number(record.price_per_kg) || 0);
        const unit = document.createElement("span");
        unit.dataset.i18n = "buyer.prices.perKg";
        unit.textContent = translate("buyer.prices.perKg");
        amount.append(value, " ", unit);

        const details = document.createElement("dl");
        details.className = "sf-market-price-details";
        const market = document.createElement("div");
        const marketLabel = document.createElement("dt");
        marketLabel.dataset.i18n = "home.prices.market";
        marketLabel.textContent = translate("home.prices.market");
        const marketName = document.createElement("dd");
        marketName.textContent = record.market_name || "Local Market";
        if (record.district) {
            const district = document.createElement("span");
            district.textContent = record.district;
            marketName.append(district);
        }
        market.append(marketLabel, marketName);

        const updated = document.createElement("div");
        const updatedLabel = document.createElement("dt");
        updatedLabel.dataset.i18n = "home.prices.updated";
        updatedLabel.textContent = translate("home.prices.updated");
        const updatedValue = document.createElement("dd");
        const date = document.createElement("time");
        date.dateTime = record.price_date || "";
        date.textContent = record.price_date || "";
        updatedValue.append(date);
        updated.append(updatedLabel, updatedValue);
        details.append(market, updated);
        body.append(heading, amount, details);
        card.append(media, body);
        window.SmartFarmerProduceImages?.setImage(image);
        return card;
    }

    function updatePagination(control, page, pages, loadPage) {
        control.dataset.page = String(page);
        control.dataset.pages = String(pages);
        control.replaceChildren();
        const previous = document.createElement("button");
        previous.type = "button";
        previous.className = "button button-quiet button-small";
        previous.textContent = translate("admin.action.previous");
        previous.disabled = page <= 1;
        previous.addEventListener("click", () => loadPage(page - 1));

        const current = document.createElement("span");
        current.setAttribute("aria-live", "polite");
        current.textContent = translate("marketPrices.pageOf", { page, pages });

        const next = document.createElement("button");
        next.type = "button";
        next.className = "button button-quiet button-small";
        next.textContent = translate("admin.action.next");
        next.disabled = pages === 0 || page >= pages;
        next.addEventListener("click", () => loadPage(page + 1));
        control.append(previous, current, next);
    }

    async function loadDashboardPage(grid, control, page) {
        const role = control.dataset.marketPricePagination;
        const response = await fetch(
            `/api/${role}/market-prices?page=${encodeURIComponent(page)}&per_page=${perPage}`,
            { credentials: "same-origin", headers: { Accept: "application/json" } }
        );
        const result = await response.json();
        if (!response.ok || result.success === false) {
            throw new Error(result.message || "Market prices could not be loaded.");
        }
        const records = result.items || [];
        grid.replaceChildren(...records.map(createCard));
        updatePagination(control, Number(result.page) || 1, Number(result.pages) || 0,
            (nextPage) => loadDashboardPage(grid, control, nextPage));
    }

    document.querySelectorAll("[data-market-price-actions]").forEach((actions) => {
        const grid = document.getElementById(actions.dataset.target);
        const button = actions.querySelector(".sf-market-price-toggle");
        if (!grid || !button) return;
        button.addEventListener("click", () => {
            const expanded = button.getAttribute("aria-expanded") !== "true";
            grid.querySelectorAll(".sf-market-price-card").forEach((card, index) => {
                card.hidden = !expanded && index >= perPage;
            });
            button.setAttribute("aria-expanded", String(expanded));
            const key = expanded ? "marketPrices.showLess" : "marketPrices.viewMore";
            button.dataset.i18n = key;
            button.textContent = translate(key);
        });
    });

    document.querySelectorAll("[data-market-price-pagination]").forEach((control) => {
        const grid = document.getElementById(`${control.dataset.marketPricePagination}-market-prices`);
        if (!grid) return;
        const page = Number(control.dataset.page) || 1;
        const pages = Number(control.dataset.pages) || 0;
        updatePagination(control, page, pages, (nextPage) => {
            loadDashboardPage(grid, control, nextPage).catch(() => {});
        });
    });

    document.addEventListener("sf:languagechange", () => {
        document.querySelectorAll("[data-market-price-actions] button").forEach((button) => {
            const key = button.getAttribute("aria-expanded") === "true"
                ? "marketPrices.showLess"
                : "marketPrices.viewMore";
            button.textContent = translate(key);
        });
        document.querySelectorAll("[data-market-price-pagination]").forEach((control) => {
            const page = Number(control.dataset.page) || 1;
            const pages = Number(control.dataset.pages) || 0;
            updatePagination(control, page, pages, (nextPage) => {
                const grid = document.getElementById(`${control.dataset.marketPricePagination}-market-prices`);
                if (grid) loadDashboardPage(grid, control, nextPage).catch(() => {});
            });
        });
    });
})();
