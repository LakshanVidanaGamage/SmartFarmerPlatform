(() => {
    "use strict";

    const perPage = 6;
    const translate = (key, values = {}) => {
        let message = window.SmartFarmerI18n?.translateKey(key, document.documentElement.lang || "en") || key;
        Object.entries(values).forEach(([name, value]) => {
            message = message.replaceAll(`{${name}}`, String(value));
        });
        return message;
    };

    document.querySelectorAll("[data-directory-pagination]").forEach((pagination) => {
        const grid = document.getElementById(pagination.dataset.directoryTarget);
        const previous = pagination.querySelector("[data-directory-previous]");
        const next = pagination.querySelector("[data-directory-next]");
        const numbers = pagination.querySelector("[data-directory-page-numbers]");
        const indicator = pagination.querySelector("[data-directory-page-of]");
        if (!grid || !previous || !next || !numbers || !indicator) return;

        const cards = Array.from(grid.querySelectorAll(":scope > [data-directory-card]"));
        const totalPages = Math.max(1, Math.ceil(cards.length / perPage));
        let page = 1;

        function render() {
            pagination.hidden = cards.length === 0;
            cards.forEach((card, index) => {
                card.hidden = index < (page - 1) * perPage || index >= page * perPage;
            });
            previous.disabled = page === 1;
            next.disabled = page === totalPages;
            numbers.replaceChildren();
            for (let number = 1; number <= totalPages; number += 1) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = String(number);
                button.setAttribute("aria-label", translate("marketPrices.pageNumber", { page: number }));
                if (number === page) button.setAttribute("aria-current", "page");
                button.addEventListener("click", () => changePage(number));
                numbers.append(button);
            }
            indicator.textContent = translate("marketPrices.pageOf", { page, pages: totalPages });
        }

        function changePage(number) {
            if (number < 1 || number > totalPages || number === page) return;
            page = number;
            render();
            grid.scrollIntoView({
                block: "start",
                behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
            });
        }

        previous.addEventListener("click", () => changePage(page - 1));
        next.addEventListener("click", () => changePage(page + 1));
        document.addEventListener("sf:languagechange", render);
        render();
    });
})();
