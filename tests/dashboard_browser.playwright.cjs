"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const BASE_URL = process.env.SMARTFARMER_TEST_BASE_URL || "http://127.0.0.1:58532";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const HTML_REPORT = path.join(PROJECT_ROOT, "AUTOMATED_BROWSER_TEST_REPORT.html");
const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BROWSER_PATH = process.env.SMARTFARMER_BROWSER_EXE || EDGE_PATH;
const RESULTS = [];
let browser;
let setupFailure = "";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

function attachDiagnostics(page) {
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], successfulResponses: [] };
    page.on("console", (message) => {
        if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("requestfailed", (request) => diagnostics.failedRequests.push({
        url: request.url(), failure: request.failure()?.errorText || "request failed",
    }));
    page.on("response", (response) => {
        if (response.status() < 400) diagnostics.successfulResponses.push(response.url());
        if (response.status() >= 400) diagnostics.badResponses.push({
            status: response.status(), url: response.url(),
        });
    });
    return diagnostics;
}

function unexpectedDiagnostics(diagnostics) {
    const badResponses = diagnostics.badResponses.filter((item) => !/\/favicon\.ico(?:\?|$)/i.test(item.url));
    const failedRequests = diagnostics.failedRequests.filter((item) => {
        if (/\/favicon\.ico(?:\?|$)/i.test(item.url)) return false;
        // An ERR_ABORTED duplicate is a browser cancellation, not a failed
        // endpoint, only when this page also observed a successful response
        // for that exact URL. Keep the raw cancellation in the HTML report.
        return !(item.failure === "net::ERR_ABORTED" && diagnostics.successfulResponses.includes(item.url));
    });
    return { ...diagnostics, badResponses, failedRequests };
}

function unexpectedConsoleErrors(diagnostics) {
    // Chromium's favicon request is emitted as a generic console 404 rather
    // than a page response event. The test server access log confirms its path.
    return diagnostics.consoleErrors.filter((message) =>
        !/^Failed to load resource: the server responded with a status of 404 \(NOT FOUND\)$/i.test(message),
    );
}

async function verifyLocalImages(page) {
    const images = page.locator("img[data-produce-image]");
    await images.first().waitFor({ state: "attached", timeout: 10000 });
    await page.waitForFunction(() => {
        const nodes = [...document.querySelectorAll("img[data-produce-image]")];
        return nodes.length > 0 && nodes.every((image) => image.complete);
    }, null, { timeout: 15000 });
    const statuses = await images.evaluateAll((nodes) => nodes.map((image) => ({
        src: image.getAttribute("src"),
        width: image.naturalWidth,
        height: image.naturalHeight,
        renderedWidth: image.getBoundingClientRect().width,
        renderedHeight: image.getBoundingClientRect().height,
        objectFit: getComputedStyle(image).objectFit,
        missing: image.dataset.produceImageMissing === "true",
        alt: image.getAttribute("alt"),
    })));
    assert.ok(statuses.length, "expected synthetic produce images");
    for (const item of statuses) {
        assert.ok(item.src && item.src.startsWith("/frontend/images/produce/"), `image is not local: ${item.src}`);
        assert.ok(item.width > 0, `image failed to load: ${item.src}`);
        assert.ok(item.height > 0 && item.renderedWidth > 0 && item.renderedHeight > 0, `image has invalid dimensions: ${item.src}`);
        assert.equal(item.objectFit, "cover", `image crop style is not cover: ${item.src}`);
        assert.equal(item.missing, false, `image resolver marked image missing: ${item.alt}`);
        assert.ok(item.alt, "produce image must have meaningful alt text");
    }
}

async function verifyLanguageThemeAndResponsive(page, route) {
    const language = page.locator("#languageSelect");
    for (const locale of ["si", "ta", "en"]) {
        const languageResponse = page.waitForResponse((response) =>
            response.url().endsWith(`/set-language/${locale}`),
        );
        await language.selectOption(locale);
        assert.ok((await languageResponse).ok(), `language request failed for ${locale}`);
        await page.waitForFunction((value) => document.documentElement.lang === value, locale);
        await page.waitForFunction(() => !document.querySelector("#languageSelect")?.disabled);
    }
    await page.waitForLoadState("networkidle");

    const themeButton = page.locator("[data-theme-toggle]").first();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await themeButton.click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("sf-theme")), "dark");
    await page.reload();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    await page.locator("[data-theme-toggle]").first().click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");

    for (const viewport of [
        { name: "desktop", width: 1440, height: 900 },
        { name: "tablet", width: 768, height: 1024 },
        { name: "mobile", width: 390, height: 844 },
    ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const dimensions = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
        }));
        assert.ok(
            Math.max(dimensions.document, dimensions.body) <= dimensions.viewport + 1,
            `${route} has horizontal overflow at ${viewport.name}: ${JSON.stringify(dimensions)}`,
        );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
}

async function enterSyntheticRole(page, role, fixture = "") {
    const suffix = fixture ? `?fixture=${encodeURIComponent(fixture)}` : "";
    const response = await page.goto(`${BASE_URL}/__test__/session/${role}${suffix}`);
    assert.ok(response && response.ok(), `synthetic ${role} session route did not return success`);
    await page.waitForURL(`**/${role}/dashboard`);
}

async function runView(title, route, role, checks) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    try {
        if (role) await enterSyntheticRole(page, role);
        const response = await page.goto(`${BASE_URL}${route}`);
        assert.ok(response && response.status() === 200, `${route} returned ${response?.status()}`);
        await checks(page);
        await verifyLanguageThemeAndResponsive(page, route);
        assert.deepEqual(diagnostics.pageErrors, [], `${route} browser JavaScript exceptions`);
        assert.deepEqual(unexpectedConsoleErrors(diagnostics), [], `${route} console errors`);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).failedRequests, [], `${route} failed requests`);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).badResponses, [], `${route} HTTP errors`);
        RESULTS.push({
            title,
            status: "PASS",
            warnings: diagnostics.consoleErrors.filter((message) => /status of 404/i.test(message)),
            diagnostics,
        });
    } catch (error) {
        RESULTS.push({ title, status: "FAIL", error: error.stack || error.message, diagnostics });
        throw error;
    } finally {
        await context.close();
    }
}

before(async () => {
    try {
        const response = await fetch(`${BASE_URL}/__test__/health`);
        assert.equal(response.status, 200, "mocked Flask server health endpoint must return 200");
        const health = await response.json();
        assert.equal(health.fixture, "synthetic-mocked", "refusing non-mocked test server");
        browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
    } catch (error) {
        setupFailure = error.stack || error.message;
        throw error;
    }
});

after(async () => {
    if (browser) await browser.close();
    const rows = RESULTS.map((result) => {
        const status = result.status === "PASS" ? "PASS" : "FAIL";
        const details = JSON.stringify({
            error: result.error || null,
            warnings: result.warnings || [],
            ...result.diagnostics,
        }, null, 2);
        return `<tr><td>${escapeHtml(result.title)}</td><td class="${status.toLowerCase()}">${status}</td><td><pre>${escapeHtml(details)}</pre></td></tr>`;
    }).join("\n");
    const report = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Smart Farmer Browser Test Report</title><style>body{font:15px system-ui,sans-serif;margin:2rem;color:#173b2a}h1{color:#176443}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5e2d8;padding:.7rem;text-align:left;vertical-align:top}.pass{color:#167345;font-weight:700}.fail{color:#ad2828;font-weight:700}pre{white-space:pre-wrap;word-break:break-word;margin:0}code{background:#eef5ef;padding:.1rem .3rem}</style><h1>Smart Farmer Browser Test Report</h1><p>Target: <code>${escapeHtml(BASE_URL)}</code> (test-only loopback server; synthetic users/data)</p>${setupFailure ? `<p class="fail">Setup blocked: ${escapeHtml(setupFailure)}</p>` : ""}<p>Passed: ${RESULTS.filter((item) => item.status === "PASS").length}; Failed: ${RESULTS.filter((item) => item.status === "FAIL").length}; Not run: ${Math.max(0, 9 - RESULTS.length)}.</p><table><thead><tr><th>View / check</th><th>Status</th><th>Diagnostics</th></tr></thead><tbody>${rows}</tbody></table></html>`;
    fs.writeFileSync(HTML_REPORT, report, "utf8");
});

test("Public Fresh Produce: search, categories, local photos, navigation, language/theme and responsive widths", async () => {
    await runView("Public Fresh Produce", "/produce", null, async (page) => {
        await verifyLocalImages(page);
        const cards = page.locator("#public-produce-grid .sf-produce-card");
        await page.locator("#produce-search").fill("tomato");
        await page.locator("#produce-filter-form button[type=submit]").click();
        await cards.first().waitFor();
        assert.equal(await cards.count(), 1);
        await page.locator('[data-produce-category-value="vegetables"]').click();
        await page.locator("#produce-search").fill("no-such-crop");
        await page.locator("#produce-filter-form button[type=submit]").click();
        await page.waitForFunction(() => document.querySelectorAll("#public-produce-grid .sf-produce-card").length === 0);
        await page.locator("#clear-produce-filters").click();
        await page.waitForFunction(() => document.querySelectorAll("#public-produce-grid .sf-produce-card").length > 0);
        assert.ok(await page.locator('.sf-back-button[href="/home"], a[href="/home"]').count());
    });
});

test("Public homepage hero: English, Sinhala and Tamil text stays inside the hero at desktop, tablet and mobile widths", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    try {
        const viewports = [
            { name: "desktop", width: 1440, height: 900 },
            { name: "tablet", width: 900, height: 1000 },
            { name: "mobile", width: 390, height: 844 },
        ];

        for (const viewport of viewports) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            for (const locale of ["en", "si", "ta"]) {
                const response = await page.goto(`${BASE_URL}/set-language/${locale}`);
                assert.ok(response && response.status() === 200, `${locale} homepage response failed at ${viewport.name}`);
                await page.waitForFunction((value) => document.documentElement.lang === value, locale);

                const metrics = await page.evaluate(() => {
                    const grid = document.querySelector(".sf-hero-grid");
                    const copy = document.querySelector(".sf-hero-copy");
                    const heading = document.querySelector("#hero-title");
                    const description = document.querySelector(".sf-hero-description");
                    const actions = document.querySelector(".sf-hero-actions");
                    const note = document.querySelector(".sf-hero-note");
                    const bounds = (node) => {
                        const rect = node.getBoundingClientRect();
                        return { top: rect.top, bottom: rect.bottom, height: rect.height };
                    };
                    return {
                        grid: { ...bounds(grid), scrollHeight: grid.scrollHeight, clientHeight: grid.clientHeight },
                        copy: { ...bounds(copy), scrollHeight: copy.scrollHeight, clientHeight: copy.clientHeight },
                        heading: { ...bounds(heading), lineHeight: parseFloat(getComputedStyle(heading).lineHeight), fontSize: parseFloat(getComputedStyle(heading).fontSize) },
                        description: { ...bounds(description), lineHeight: parseFloat(getComputedStyle(description).lineHeight), fontSize: parseFloat(getComputedStyle(description).fontSize) },
                        actions: bounds(actions),
                        note: bounds(note),
                        viewportWidth: document.documentElement.clientWidth,
                        pageWidth: document.documentElement.scrollWidth,
                    };
                });
                const contentBottom = Math.max(metrics.heading.bottom, metrics.description.bottom, metrics.actions.bottom, metrics.note.bottom);
                assert.ok(metrics.copy.top >= metrics.grid.top, `${locale}/${viewport.name}: hero copy starts outside the hero`);
                assert.ok(contentBottom <= metrics.grid.bottom, `${locale}/${viewport.name}: hero content is clipped at the bottom: ${JSON.stringify(metrics)}`);
                assert.ok(metrics.grid.scrollHeight <= metrics.grid.clientHeight + 1, `${locale}/${viewport.name}: hero has overflowing content: ${JSON.stringify(metrics)}`);
                assert.ok(metrics.copy.scrollHeight <= metrics.copy.clientHeight + 1, `${locale}/${viewport.name}: hero text panel has overflowing content`);
                if (locale !== "en") {
                    assert.ok(metrics.heading.lineHeight / metrics.heading.fontSize >= 1.18, `${locale}/${viewport.name}: heading leading is too tight for diacritics`);
                }
                assert.ok(metrics.description.lineHeight / metrics.description.fontSize >= 1.5, `${locale}/${viewport.name}: paragraph leading is too tight`);
                assert.ok(metrics.pageWidth <= metrics.viewportWidth + 1, `${locale}/${viewport.name}: horizontal overflow`);
            }
        }
        assert.deepEqual(diagnostics.pageErrors, []);
        assert.deepEqual(unexpectedConsoleErrors(diagnostics), []);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).failedRequests, []);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).badResponses, []);
        RESULTS.push({ title: "Public homepage hero clipping", status: "PASS", diagnostics });
    } catch (error) {
        RESULTS.push({ title: "Public homepage hero clipping", status: "FAIL", error: error.stack || error.message, diagnostics });
        throw error;
    } finally {
        await context.close();
    }
});

test("Farmer Dashboard: API-backed produce, search/categories, navigation, language/theme and responsive widths", async () => {
    await runView("Farmer Dashboard", "/farmer/dashboard", "farmer", async (page) => {
        await verifyLocalImages(page);
        const cards = page.locator("#myProduce .fd-produce-listing-card");
        await page.locator("#farmerProduceSearch").fill(" TOMATO ");
        await cards.first().waitFor();
        assert.equal(await cards.count(), 1);
        await page.locator('[data-produce-category-value="fruits"]').click();
        assert.equal(await cards.count(), 0);
        await page.locator("#farmerProduceSearchClear").click();
        await page.locator('[data-produce-category-value="all"]').click();
        assert.equal(await page.locator("#myProduce .fd-produce-listing-card").count(), 1);
        assert.ok(await page.locator('a[href="/farmer/produce"]').count());
    });
});

test("Farmer Full Produce: owned listings, local photos, back navigation and responsive widths", async () => {
    await runView("Farmer Full Produce", "/farmer/produce", "farmer", async (page) => {
        await verifyLocalImages(page);
        assert.ok(await page.locator('a[href="/farmer/dashboard"]').count());
        await page.locator("#farmerProduceSearch").fill("beans");
        assert.equal(await page.locator("#myProduce .fd-produce-listing-card").count(), 1);
        await page.locator('[data-produce-category-value="fruits"]').click();
        assert.equal(await page.locator("#myProduce .fd-produce-listing-card").count(), 0);
    });
});

test("Farmer My Produce: every category and result count retain the responsive three-column grid", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    const cards = page.locator("#myProduce .fd-produce-listing-card");
    const grid = page.locator("#myProduce");
    const expectedCategories = [
        ["all", 23], ["vegetables", 15], ["fruits", 1], ["spices", 1],
        ["leafy_vegetables", 1], ["root_tuber_crops", 1], ["grains_pulses", 1],
        ["gourds_climbing_vegetables", 1], ["herbs", 1], ["other_crops", 1],
    ];
    const columnCount = async () => grid.evaluate((node) =>
        getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length,
    );
    try {
        await enterSyntheticRole(page, "farmer", "layout");
        await page.waitForLoadState("networkidle");
        const response = await page.goto(`${BASE_URL}/farmer/produce`);
        assert.equal(response?.status(), 200);
        await page.waitForFunction(() => document.querySelectorAll("#myProduce .fd-produce-listing-card").length === 23);
        for (const [category, count] of expectedCategories) {
            await page.locator(`[data-produce-category-value="${category}"]`).click();
            assert.equal(await cards.count(), count, `${category} should show ${count} matching cards`);
            assert.equal(await columnCount(), 3, `${category} should retain three desktop grid tracks`);
            if (count <= 2) {
                const dimensions = await cards.first().evaluate((node) => ({
                    card: node.getBoundingClientRect().width,
                    grid: node.parentElement.getBoundingClientRect().width,
                }));
                assert.ok(dimensions.card < dimensions.grid * 0.5, `${category} card stretched beyond its grid track`);
            }
        }

        await page.locator("[data-produce-category-value=vegetables]").click();
        const search = page.locator("#farmerProduceSearch");
        for (const [term, count] of [["group1", 1], ["group2", 2], ["group3", 3], ["group4", 4], ["group5", 5]]) {
            await search.fill(term);
            assert.equal(await cards.count(), count, `category + ${term} search should show ${count} cards`);
            assert.equal(await columnCount(), 3, `${term} results should retain three desktop grid tracks`);
        }

        await search.fill("");
        for (const viewport of [
            { name: "desktop", width: 1440, height: 900, columns: 3 },
            { name: "tablet", width: 768, height: 1024, columns: 2 },
            { name: "mobile", width: 390, height: 844, columns: 1 },
        ]) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            assert.equal(await columnCount(), viewport.columns, `${viewport.name} should use ${viewport.columns} columns`);
            const widths = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                page: document.documentElement.scrollWidth,
            }));
            assert.ok(widths.page <= widths.viewport + 1, `${viewport.name} layout overflows horizontally`);
        }
        assert.deepEqual(diagnostics.pageErrors, []);
        assert.deepEqual(unexpectedConsoleErrors(diagnostics), []);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).failedRequests, []);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).badResponses, []);
        RESULTS.push({ title: "Farmer My Produce category grid", status: "PASS", diagnostics });
    } catch (error) {
        RESULTS.push({ title: "Farmer My Produce category grid", status: "FAIL", error: error.stack || error.message, diagnostics });
        throw error;
    } finally {
        await context.close();
    }
});

test("Buyer Dashboard: synthetic listings, search/categories, navigation, language/theme and responsive widths", async () => {
    await runView("Buyer Dashboard", "/buyer/dashboard", "buyer", async (page) => {
        await verifyLocalImages(page);
        const cards = page.locator("#produceList .bd-produce-card");
        await page.locator("#buyerProduceSearch").fill(" TOMATO ");
        assert.equal(await cards.count(), 1);
        await page.locator('[data-produce-category-value="fruits"]').click();
        assert.equal(await page.locator("#produceList .bd-produce-card:visible").count(), 0);
        await page.locator("#buyerProduceSearchClear").click();
        await page.locator('[data-produce-category-value="all"]').click();
        assert.equal(await page.locator("#produceList .bd-produce-card:visible").count(), 1);
        assert.ok(await page.locator('a[href="/buyer/produce"]').count());
    });
});

test("Buyer Full Produce: filtered listings, local photos, back navigation and responsive widths", async () => {
    await runView("Buyer Full Produce", "/buyer/produce?crop=tomato", "buyer", async (page) => {
        await verifyLocalImages(page);
        assert.ok(await page.locator('a[href="/buyer/dashboard"]').count());
        assert.equal(await page.locator("#produceList .bd-produce-card").count(), 1);
    });
});

test("Public Farmer Profile: synthetic profile, local photos, navigation, language/theme and responsive widths", async () => {
    await runView("Public Farmer Profile", "/farmers/71001", null, async (page) => {
        await verifyLocalImages(page);
        assert.ok((await page.locator("h1").innerText()).includes("Synthetic Farmer"));
        assert.ok(await page.locator('a[href="/farmers"]').count());
    });
});

test("Authorization: synthetic Farmer and Buyer sessions cannot open the other role's dashboard", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    try {
        await enterSyntheticRole(page, "farmer");
        await page.goto(`${BASE_URL}/buyer/dashboard`);
        await page.waitForURL("**/farmer/dashboard");
        assert.equal(await page.locator("body").getAttribute("data-page-view"), "dashboard");

        await enterSyntheticRole(page, "buyer");
        await page.goto(`${BASE_URL}/farmer/dashboard`);
        await page.waitForURL("**/buyer/dashboard");
        assert.equal(await page.locator("body").getAttribute("data-page-view"), "dashboard");
        assert.deepEqual(diagnostics.pageErrors, []);
        assert.deepEqual(diagnostics.consoleErrors, []);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).failedRequests, []);
        assert.deepEqual(unexpectedDiagnostics(diagnostics).badResponses, []);
        RESULTS.push({ title: "Role authorization", status: "PASS", diagnostics });
    } catch (error) {
        RESULTS.push({ title: "Role authorization", status: "FAIL", error: error.stack || error.message, diagnostics });
        throw error;
    } finally {
        await context.close();
    }
});
