(() => {
    "use strict";

    if (document.body.dataset.pageView !== "dashboard") return;

    const perPage = 3;
    const controls = Array.from(document.querySelectorAll("[data-overview-pagination]"));
    const translate = (key, fallback, values = {}) => {
        let message = window.SmartFarmerI18n?.translateKey(
            key, document.documentElement.lang || "en"
        ) || fallback;
        for (const [name, value] of Object.entries(values)) {
            message = message.replaceAll(`{${name}}`, String(value));
        }
        return message;
    };

    function render(control, resetPage = false) {
        const list = document.getElementById(control.dataset.overviewPagination);
        if (!list) {
            control.replaceChildren();
            return;
        }
        const cards = Array.from(list.children).filter((child) =>
            child.matches(control.dataset.cardSelector)
        );
        const matching = cards.filter((card) => card.dataset.overviewFilterMatch !== "false");
        const pages = Math.ceil(matching.length / perPage);
        const requested = resetPage ? 1 : Number(control.dataset.page) || 1;
        const page = Math.max(1, Math.min(requested, pages || 1));
        control.dataset.page = String(page);
        control.dataset.pages = String(pages);

        cards.forEach((card) => {
            const index = matching.indexOf(card);
            card.hidden = index < 0 || index < (page - 1) * perPage || index >= page * perPage;
        });

        if (pages <= 1) {
            control.replaceChildren();
            return;
        }
        const previous = document.createElement("button");
        previous.type = "button";
        previous.textContent = translate("admin.action.previous", "Previous");
        previous.disabled = page === 1;
        previous.addEventListener("click", () => {
            control.dataset.page = String(page - 1);
            render(control);
        });

        const indicator = document.createElement("span");
        indicator.textContent = translate("marketPrices.pageOf", "Page {page} of {pages}", { page, pages });

        const next = document.createElement("button");
        next.type = "button";
        next.textContent = translate("admin.action.next", "Next");
        next.disabled = page === pages;
        next.addEventListener("click", () => {
            control.dataset.page = String(page + 1);
            render(control);
        });
        control.replaceChildren(previous, indicator, next);
    }

    controls.forEach((control) => {
        const list = document.getElementById(control.dataset.overviewPagination);
        if (!list) return;
        new MutationObserver(() => render(control)).observe(list, { childList: true });
        render(control, true);
    });
    document.addEventListener("sf:overview-produce-filter", () => {
        const control = controls.find((item) => item.dataset.overviewPagination === "produceList");
        if (control) render(control, true);
    });
    document.addEventListener("sf:languagechange", () => {
        controls.forEach((control) => render(control));
    });
})();
