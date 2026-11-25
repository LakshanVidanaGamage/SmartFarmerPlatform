(() => {
    "use strict";

    const perPage = 12;
    const form = document.getElementById("public-price-form");
    const grid = document.getElementById("public-price-grid");
    const search = document.getElementById("public-price-search");
    const clear = document.getElementById("public-price-clear");
    const count = document.getElementById("public-price-count");
    const empty = document.getElementById("public-price-empty");
    const previous = document.getElementById("public-price-previous");
    const next = document.getElementById("public-price-next");
    const pages = document.getElementById("public-price-pages");
    const pageOf = document.getElementById("public-price-page-of");
    if (!form || !grid || !search || !clear || !count || !empty || !previous || !next || !pages || !pageOf) return;

    const cards = Array.from(grid.querySelectorAll(":scope > .sf-market-price-card"));
    const names = cards.map((card) => card.querySelector("h3")?.textContent || "");
    const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase().trim();
    const translate = (key, values = {}) => {
        let message = window.SmartFarmerI18n?.translateKey(key, document.documentElement.lang || "en") || key;
        Object.entries(values).forEach(([name, value]) => {
            message = message.replaceAll(`{${name}}`, String(value));
        });
        return message;
    };
    let currentPage = 1;

    function render() {
        const query = normalize(search.value);
        const matches = cards.filter((_, index) => normalize(names[index]).includes(query));
        const totalPages = Math.max(1, Math.ceil(matches.length / perPage));
        currentPage = Math.min(Math.max(1, currentPage), totalPages);
        const visible = new Set(matches.slice((currentPage - 1) * perPage, currentPage * perPage));

        cards.forEach((card) => { card.hidden = !visible.has(card); });
        grid.classList.add("sf-public-price-ready");
        clear.hidden = search.value.length === 0;
        count.textContent = translate("marketPrices.resultsCount", { count: matches.length });

        empty.hidden = matches.length !== 0;
        if (!matches.length) {
            const key = cards.length ? "marketPrices.noResults" : "home.prices.empty";
            empty.dataset.i18n = key;
            empty.textContent = translate(key);
        }

        previous.disabled = currentPage === 1;
        next.disabled = currentPage === totalPages;
        pages.replaceChildren();
        for (let page = 1; page <= totalPages; page += 1) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = String(page);
            button.setAttribute("aria-label", translate("marketPrices.pageNumber", { page }));
            if (page === currentPage) button.setAttribute("aria-current", "page");
            button.addEventListener("click", () => {
                currentPage = page;
                render();
            });
            pages.append(button);
        }
        pageOf.textContent = translate("marketPrices.pageOf", { page: currentPage, pages: totalPages });
    }

    search.addEventListener("input", () => {
        currentPage = 1;
        render();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        currentPage = 1;
        render();
    });
    clear.addEventListener("click", () => {
        search.value = "";
        currentPage = 1;
        render();
        search.focus();
    });
    previous.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage -= 1;
            render();
        }
    });
    next.addEventListener("click", () => {
        if (!next.disabled) {
            currentPage += 1;
            render();
        }
    });
    document.addEventListener("sf:languagechange", render);
    render();
})();
