/* Smart Farmer homepage controls: theme, navigation, and language. */
(() => {
    "use strict";

    const STORAGE_KEY = "sf-theme";
    const DEFAULT_THEME = "light";

    function getSavedTheme() {
        try {
            const savedTheme = localStorage.getItem(STORAGE_KEY);
            return savedTheme === "dark" || savedTheme === "light"
                ? savedTheme
                : DEFAULT_THEME;
        } catch (error) {
            return DEFAULT_THEME;
        }
    }

    function updateThemeButtons(theme) {
        document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
            const isDark = theme === "dark";
            const translations = window.SmartFarmerI18n;
            if (translations && typeof translations.updateThemeButton === "function") {
                translations.updateThemeButton(button, theme);
                return;
            }
            button.setAttribute(
                "aria-label",
                isDark ? "Switch to light mode" : "Switch to dark mode"
            );
            button.setAttribute("aria-pressed", String(isDark));
            button.textContent = isDark ? "Light mode" : "Dark mode";
        });
    }

    function applyTheme(theme) {
        const selectedTheme = theme === "dark" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", selectedTheme);
        document.documentElement.style.colorScheme = selectedTheme;

        try {
            localStorage.setItem(STORAGE_KEY, selectedTheme);
        } catch (error) {
            // The theme still works for this page if storage is unavailable.
        }

        updateThemeButtons(selectedTheme);
    }

    function toggleTheme() {
        const currentTheme =
            document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
        applyTheme(currentTheme === "dark" ? "light" : "dark");
    }

    function createThemeButton() {
        const header = document.querySelector("[data-site-header]");
        if (!header) return;

        const actions = header.querySelector("[data-header-actions]") || header;
        if (actions.querySelector("[data-theme-toggle]")) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "sf-theme-btn";
        button.setAttribute("data-theme-toggle", "");
        button.addEventListener("click", toggleTheme);
        actions.appendChild(button);
    }

    function initialiseMobileNavigation() {
        const header = document.querySelector("[data-site-header]");
        const toggle = document.querySelector("[data-menu-toggle]");
        const panel = document.querySelector("[data-mobile-panel]");
        if (!header || !toggle || !panel) return;

        function setMenuOpen(isOpen) {
            header.classList.toggle("is-menu-open", isOpen);
            toggle.setAttribute("aria-expanded", String(isOpen));
            const labelKey = isOpen ? "public.nav.close" : "public.nav.open";
            toggle.setAttribute("data-i18n-aria-label", labelKey);
            toggle.setAttribute(
                "aria-label",
                window.SmartFarmerI18n?.translateKey(labelKey)
                    || (isOpen ? "Close navigation menu" : "Open navigation menu")
            );
        }

        toggle.addEventListener("click", function() {
            setMenuOpen(toggle.getAttribute("aria-expanded") !== "true");
        });

        panel.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", function() {
                setMenuOpen(false);
            });
        });

        document.addEventListener("click", function(event) {
            if (
                header.classList.contains("is-menu-open") &&
                !header.contains(event.target)
            ) {
                setMenuOpen(false);
            }
        });

        document.addEventListener("keydown", function(event) {
            if (event.key === "Escape") setMenuOpen(false);
        });

        window.addEventListener("resize", function() {
            if (window.innerWidth > 1360) setMenuOpen(false);
        });
    }

    function initialiseLanguageSelector() {
        const selector = document.getElementById("languageSelect");
        if (!selector) return;

        selector.addEventListener("change", async function() {
            const language = selector.value;
            if (document.body.hasAttribute("data-auth-page") || document.querySelector("[data-site-header]")) {
                selector.disabled = true;
                try {
                    const response = await fetch(
                        "/set-language/" + encodeURIComponent(language),
                        {
                            method: "GET",
                            headers: { "Accept": "application/json" },
                            credentials: "same-origin"
                        }
                    );
                    if (!response.ok) throw new Error("Language update failed.");
                    document.documentElement.lang = language;
                    if (window.SmartFarmerI18n) {
                        window.SmartFarmerI18n.apply(language);
                    }
                } catch (error) {
                    selector.value = document.documentElement.lang || "en";
                } finally {
                    selector.disabled = false;
                }
                return;
            }

            window.location.href = "/set-language/" + language;
        });
    }

    function initialiseLanguageOnboarding() {
        const choices = document.querySelectorAll("[data-language-choice]");
        const continueLink = document.getElementById("languageContinue");
        if (!choices.length || !continueLink) return;

        choices.forEach((choice) => {
            choice.addEventListener("click", function(event) {
                event.preventDefault();
                choices.forEach((item) => {
                    const selected = item === choice;
                    item.classList.toggle("is-selected", selected);
                    item.setAttribute("aria-current", selected ? "page" : "false");
                });
                continueLink.href = choice.href;
            });
        });
    }

    function initialise() {
        applyTheme(getSavedTheme());
        createThemeButton();

        document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
            button.addEventListener("click", toggleTheme);
        });

        initialiseMobileNavigation();
        initialiseLanguageSelector();
        initialiseLanguageOnboarding();
    }

    applyTheme(getSavedTheme());

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise);
    } else {
        initialise();
    }

    window.SmartFarmerTheme = {
        setTheme: applyTheme,
        toggleTheme: toggleTheme,
        getTheme: getSavedTheme
    };
})();
