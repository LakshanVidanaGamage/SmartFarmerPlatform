const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const imageDirectory = path.join(root, "frontend/images/produce");
const resolverSource = read("frontend/js/produce-images.js");
const readme = read("frontend/images/produce/README.md");

class FakeImage {
    constructor(name, category = "") {
        this.dataset = { produceName: name, produceCategory: category };
        this.alt = `Fresh ${name}`;
        this.hidden = false;
        this.listeners = {};
        this.attributes = new Set();
        this.src = "";
    }

    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name) { this.attributes.add(name); }
    removeAttribute(name) {
        this.attributes.delete(name);
        if (name === "src") this.src = "";
    }
}

function loadResolver() {
    const document = {
        documentElement: { lang: "en" },
        querySelectorAll: () => [],
        addEventListener: () => {},
        dispatchEvent: () => {},
    };
    const window = {};
    const context = { document, window, Element: class Element {}, HTMLImageElement: FakeImage };
    vm.runInNewContext(resolverSource, context, { filename: "produce-images.js" });
    return window.SmartFarmerProduceImages;
}

function extractRules() {
    const start = resolverSource.indexOf("const PHOTO_RULES = [") + "const PHOTO_RULES = ".length;
    const end = resolverSource.indexOf("\n\n    const CATEGORY_RULES", start);
    assert.ok(start >= 0 && end > start, "could not find the centralized photo rules");
    return vm.runInNewContext(resolverSource.slice(start, end));
}

function markdownRows(section) {
    return section.split(/\r?\n/).filter((line) => /^\| [^|]+ \| [^|]+ \| `[^`]+\.jpg` \|/.test(line));
}

const resolver = loadResolver();
const photoRules = extractRules();

test("all 86 exact crop mappings point to existing, unique image files", () => {
    const files = photoRules.map((rule) => rule.file);
    assert.equal(files.length, 86);
    assert.equal(new Set(files).size, 86, "photo mapping contains duplicate filenames");
    for (const file of files) assert.ok(fs.existsSync(path.join(imageDirectory, file)), `missing image: ${file}`);

    const localImages = fs.readdirSync(imageDirectory).filter((file) => /\.(?:jpg|jpeg|png|webp)$/i.test(file));
    const hashes = localImages.map((file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(imageDirectory, file))).digest("hex"));
    assert.equal(new Set(hashes).size, hashes.length, "local image library contains byte-identical image files");
});

test("README documents all 71 crops and every documented image exists", () => {
    const photoSection = readme.split("## Crop-specific photo inventory")[1]?.split("## Category fallback photographs")[0] || "";
    const cropSection = readme.split("## Sri Lankan crop inventory and photo coverage")[1]?.split("## Mapping and filtering behavior")[0] || "";
    const photoRows = markdownRows(photoSection);
    const cropRows = markdownRows(cropSection);
    assert.equal(photoRows.length, 86);
    assert.equal(cropRows.length, 71);
    for (const line of [...photoRows, ...cropRows]) {
        const file = line.match(/`([^`]+\.jpg)`/)?.[1];
        assert.ok(file && fs.existsSync(path.join(imageDirectory, file)), `README refers to a missing image: ${file || line}`);
    }
});

test("every English, Sinhala, and Tamil resolver alias selects its exact photo", () => {
    const aliases = photoRules.flatMap((rule) => rule.names.map((name) => ({ name, expected: rule.file })));
    assert.equal(aliases.length, 516);
    for (const { name, expected } of aliases) {
        assert.equal(resolver.resolve(name), expected, `alias did not resolve: ${name}`);
    }
});

test("all mapped crop categories match the shared category classifier", () => {
    assert.deepEqual(Array.from(resolver.categories, ({ id }) => id), [
        "all", "vegetables", "fruits", "spices", "leafy_vegetables", "root_tuber_crops",
        "grains_pulses", "gourds_climbing_vegetables", "herbs", "other_crops",
    ]);
    for (const rule of photoRules) {
        assert.equal(resolver.classify(rule.names[0]), rule.category, `wrong category: ${rule.names[0]}`);
    }
});

test("normalization is case/space insensitive and exact crop matches do not use partial names", () => {
    assert.equal(resolver.resolve("  GREEN   BEANS  "), "green-beans.jpg");
    assert.equal(resolver.resolve("TOMATO"), "tomatoes.jpg");
    assert.equal(resolver.resolve("kiriala"), "kiriala.jpg");
    assert.equal(resolver.resolve("kiri ala"), "kiri-ala.jpg");
    assert.equal(resolver.resolve("black pepper"), "black-pepper.jpg");
    assert.equal(resolver.resolve("bell pepper"), "capsicum.jpg");
    assert.notEqual(resolver.resolve("tomato soup"), "tomatoes.jpg");
    assert.notEqual(resolver.resolve("black pepper and bell pepper"), "black-pepper.jpg");
});

test("unknown names use available suitable fallbacks; unsupported grain fallback stays hidden", () => {
    assert.equal(resolver.resolve("unlisted crop"), "produce-fallback.jpg");
    assert.equal(resolver.resolve("unlisted crop", "fruits"), "fruit-fallback.jpg");
    assert.equal(resolver.resolve("unlisted crop", "grains and pulses"), null);
    assert.match(readme, /No suitable local category fallback photograph is currently available for \*\*Grains and Pulses\*\*/);
    for (const file of [resolver.resolve("unlisted crop"), resolver.resolve("unlisted crop", "fruits")]) {
        assert.ok(fs.existsSync(path.join(imageDirectory, file)), `missing fallback image: ${file}`);
    }
});

test("image resolver assigns local paths and applies its category fallback on load error", () => {
    const image = new FakeImage("tomato", "vegetables");
    resolver.setImage(image);
    assert.equal(image.src, "/frontend/images/produce/tomatoes.jpg");
    image.listeners.error();
    assert.equal(image.src, "/frontend/images/produce/produce-fallback.jpg");
    image.listeners.error();
    assert.equal(image.hidden, true);
    assert.equal(image.src, "");

    const unknownGrain = new FakeImage("unlisted crop", "grains and pulses");
    resolver.setImage(unknownGrain);
    assert.equal(unknownGrain.hidden, true);
    assert.equal(unknownGrain.dataset.produceImageMissing, "true");
});

test("market prices use mixed produce photos when an exact photo is missing or fails", () => {
    const marketImage = (name, category) => {
        const image = new FakeImage(name, category);
        image.dataset.produceImageFallback = "mixed";
        resolver.setImage(image);
        return image;
    };

    const rice = marketImage("நெல்", "grains and pulses");
    assert.equal(rice.src, "/frontend/images/produce/rice.jpg");
    rice.listeners.error();
    assert.equal(rice.src, "/frontend/images/produce/produce-fallback.jpg");
    assert.equal(rice.alt, "Representative produce photograph");
    assert.ok(rice.attributes.has("data-i18n-alt"));
    assert.equal(rice.hidden, false);

    const orange = marketImage("දොඩම්");
    assert.equal(orange.src, "/frontend/images/produce/oranges.jpg");
    orange.listeners.error();
    assert.equal(orange.src, "/frontend/images/produce/fruit-fallback.jpg");

    const unknownGrain = marketImage("unlisted crop", "grains and pulses");
    assert.equal(unknownGrain.src, "/frontend/images/produce/produce-fallback.jpg");
    assert.equal(unknownGrain.hidden, false);
});

test("category labels update on language change without recursively dispatching language events", () => {
    const documentListeners = new Map();
    let applyCalls = 0;
    class FakeElement {
        constructor() {
            this.dataset = {};
            this.children = [];
            this.attributes = {};
            this.classList = { toggle: () => {} };
        }
        setAttribute(name, value) { this.attributes[name] = value; }
        append(...nodes) { this.children.push(...nodes); }
        appendChild(node) { this.children.push(node); }
        addEventListener(name, callback) { this.listeners ||= {}; this.listeners[name] = callback; }
        querySelectorAll(selector) {
            if (selector === "[data-produce-category-value]") return this.children;
            if (selector === "[data-i18n]") return this.children.flatMap((child) => child.children).filter((child) => child.dataset.i18n);
            return [];
        }
        contains() { return true; }
        replaceChildren(...nodes) { this.children = nodes; }
    }
    const document = {
        documentElement: { lang: "en" },
        querySelectorAll: () => [],
        createElement: () => new FakeElement(),
        addEventListener: (name, callback) => documentListeners.set(name, callback),
        dispatchEvent: (event) => documentListeners.get(event.type)?.(event),
    };
    const window = {
        SmartFarmerI18n: {
            translateKey: (key, locale) => `${locale}:${key}`,
            apply: () => { applyCalls += 1; throw new Error("recursive i18n apply should not be called"); },
        },
    };
    const context = { document, window, Element: FakeElement, HTMLImageElement: FakeImage };
    vm.runInNewContext(resolverSource, context, { filename: "produce-images.js" });

    const container = new FakeElement();
    container.dataset = {};
    window.SmartFarmerProduceImages.mountCategoryFilter(container, () => {});
    assert.equal(applyCalls, 0);
    const firstLabel = container.children[0].children.find((child) => child.dataset.i18n);
    assert.equal(firstLabel.textContent, "en:produce.category.all");

    document.documentElement.lang = "si";
    document.dispatchEvent({ type: "sf:languagechange" });
    assert.equal(firstLabel.textContent, "si:produce.category.all");
    assert.equal(applyCalls, 0);
});

test("the six requested views are wired to the shared image resolver and active scripts", () => {
    const publicProduce = read("backend/templates/public_produce.html");
    const farmer = read("backend/templates/farmer_dashboard.html");
    const buyer = read("backend/templates/buyer_dashboard.html");
    const profile = read("backend/templates/public_profile.html");
    const app = read("backend/app.py");
    assert.match(publicProduce, /produce-images\.js/);
    assert.match(publicProduce, /public_produce\.js/);
    assert.match(publicProduce, /publicProduceCategoryFilter/);
    assert.match(farmer, /produce-images\.js/);
    assert.match(farmer, /farmer_dashboard\.js/);
    assert.match(farmer, /farmerProduceCategoryFilter/);
    assert.match(buyer, /produce-images\.js/);
    assert.match(buyer, /buyer_dashboard\.js/);
    assert.match(buyer, /buyerProduceCategoryFilter/);
    assert.match(profile, /produce-images\.js/);
    assert.match(profile, /data-produce-image/);
    assert.match(app, /@app\.route\("\/farmer\/produce"\)/);
    assert.match(app, /@app\.route\("\/buyer\/produce"\)/);
    assert.match(app, /@app\.route\("\/farmers\/\<int:farmer_id\>"\)/);
    for (const file of ["frontend/js/produce-images.js", "frontend/js/public_produce.js", "backend/static/js/farmer_dashboard.js", "backend/static/js/buyer_dashboard.js"]) {
        assert.ok(fs.existsSync(path.join(root, file)), `missing active script: ${file}`);
    }
});

test("Farmer and Buyer dashboard/list routes enforce their expected role guards", () => {
    const app = read("backend/app.py");
    const routeBody = (functionName) => {
        const start = app.indexOf(`def ${functionName}(`);
        assert.notEqual(start, -1, `missing route function ${functionName}`);
        const nextRoute = app.indexOf("@app.route(", start);
        return app.slice(start, nextRoute === -1 ? app.length : nextRoute);
    };
    for (const [name, role] of [
        ["farmer_dashboard", "farmer"], ["_render_farmer_list_page", "farmer"],
        ["buyer_dashboard", "buyer"], ["_render_buyer_list_page", "buyer"],
    ]) {
        const body = routeBody(name);
        assert.match(body, /"user_id" not in session[\s\S]*?url_for\("login"\)/, `${name} must reject missing sessions`);
        assert.match(body, new RegExp(`session\\.get\\("role"\\) != "${role}"[\\s\\S]*?url_for\\("dashboard"\\)`), `${name} must reject the wrong role`);
    }
});

test("Farmer produce rendering applies normalized search and category filters", () => {
    const source = read("backend/static/js/farmer_dashboard.js");
    const start = source.indexOf("    function renderProduce() {");
    const end = source.indexOf("\n    function updateProduceViewToggle()", start);
    assert.ok(start >= 0 && end > start, "Farmer renderProduce implementation exists");
    const implementation = source.slice(start, end);

    class MockNode {
        constructor(tag = "div", className = "", textContent = "") {
            this.tagName = tag;
            this.className = className;
            this.textContent = textContent;
            this.dataset = {};
            this.children = [];
            this.attributes = {};
        }
        append(...nodes) { this.children.push(...nodes); }
        appendChild(node) { this.children.push(node); }
        setAttribute(name, value) { this.attributes[name] = value; }
        replaceChildren(...nodes) { this.children = nodes; }
    }

    const search = { value: "  TOMATO  " };
    const produceContainer = new MockNode("div", "fd-produce-grid");
    const categoryFor = (name) => name.toLowerCase() === "orange" ? "fruits" : "vegetables";
    const context = {
        produceContainer,
        produceData: [
            { produce_name: "Tomato", category_name: "Vegetables", quantity: 12, unit: "kg", price_per_unit: 250, district: "Galle", description: "Synthetic tomato", produce_id: 1, available: 1 },
            { produce_name: "Beans", category_name: "Vegetables", quantity: 8, unit: "kg", price_per_unit: 300, district: "Matara", description: "Synthetic beans", produce_id: 2, available: 1 },
            { produce_name: "Orange", category_name: "Fruits", quantity: 4, unit: "kg", price_per_unit: 180, district: "Galle", description: "Synthetic orange", produce_id: 3, available: 1 },
        ],
        activeProduceCategory: "vegetables",
        byId: (id) => id === "farmerProduceSearch" ? search : null,
        normalizeProduceName: (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(),
        window: { SmartFarmerProduceImages: { classify: categoryFor } },
        el: (tag, className, text) => new MockNode(tag, className, String(text ?? "")),
        translatedNode: (tag, className, key) => new MockNode(tag, className, key),
        actionButton: () => new MockNode("button"),
        detail: () => new MockNode("div"),
        openEdit: () => {},
        deleteProduce: () => {},
        t: (key) => key,
        applyTranslations: () => {},
        showEmpty: (container, titleKey, copyKey) => { container.emptyState = { titleKey, copyKey }; },
    };
    vm.runInNewContext(implementation, context, { filename: "farmer_dashboard.js:renderProduce" });
    vm.runInNewContext("renderProduce()", context);

    assert.equal(produceContainer.children.length, 1);
    const renderedImage = produceContainer.children[0].children[0];
    assert.equal(renderedImage.dataset.produceName, "Tomato");
    assert.equal(renderedImage.dataset.produceCategory, "Vegetables");

    context.activeProduceCategory = "fruits";
    vm.runInNewContext("renderProduce()", context);
    assert.equal(produceContainer.children.length, 0);
    assert.equal(produceContainer.emptyState.titleKey, "farmer.search.noMatchesTitle");
});

test("Buyer produce search combines case-insensitive query and category filters", () => {
    const source = read("backend/static/js/buyer_dashboard.js");
    const start = source.indexOf("    function normaliseProduceName(value) {");
    const end = source.indexOf("\n    function initialiseProduceSearch()", start);
    assert.ok(start >= 0 && end > start, "Buyer search/filter implementation exists");
    const implementation = source.slice(start, end);

    const makeCard = (name, category) => ({
        hidden: false,
        dataset: {},
        querySelector(selector) {
            if (selector === "h3") return { textContent: name };
            if (selector === "[data-produce-image]") return { dataset: { produceCategory: category } };
            return null;
        },
    });
    const cards = [
        makeCard("Tomato", "Vegetables"),
        makeCard("Beans", "Vegetables"),
        makeCard("Orange", "Fruits"),
    ];
    const search = { value: "  TOMATO  " };
    const list = { hidden: false, querySelectorAll: () => cards };
    const empty = { hidden: true };
    const count = { textContent: "", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const nodes = { buyerProduceSearch: search, produceList: list, buyerSearchEmpty: empty, produceSectionCount: count };
    const context = {
        activeProduceCategory: "all",
        byId: (id) => nodes[id] || null,
        window: { SmartFarmerProduceImages: { classify: (_name, category) => category.toLowerCase() } },
        t: (_key, values) => `${values.count} listings`,
    };
    vm.runInNewContext(implementation, context, { filename: "buyer_dashboard.js:filterProduceCards" });
    vm.runInNewContext("filterProduceCards()", context);
    assert.deepEqual(cards.map((card) => card.hidden), [false, true, true]);
    assert.equal(count.textContent, "1 listings");
    assert.equal(empty.hidden, true);

    context.activeProduceCategory = "fruits";
    vm.runInNewContext("filterProduceCards()", context);
    assert.deepEqual(cards.map((card) => card.hidden), [true, true, true]);
    assert.equal(count.textContent, "0 listings");
    assert.equal(empty.hidden, false);
    assert.equal(list.hidden, true);
});

test("search combines with categories, and Clear resets the public category filter", () => {
    const publicProduce = read("frontend/js/public_produce.js");
    const farmer = read("backend/static/js/farmer_dashboard.js");
    const buyer = read("backend/static/js/buyer_dashboard.js");
    assert.match(publicProduce, /\(!query \|\| name\.includes\(query\)\)[\s\S]*appliedCategory === "all"/);
    const clearHandler = publicProduce.match(/clearButton\?\.addEventListener\("click",[\s\S]*?\n    \}\);/);
    assert.ok(clearHandler, "public produce Clear Filter handler exists");
    assert.match(clearHandler[0], /appliedCategory = "all"/);
    assert.match(clearHandler[0], /categoryFilter\.setActive\("all"\)/);
    assert.match(clearHandler[0], /render\(\);/);
    assert.match(farmer, /search\?\.addEventListener\("input"/);
    assert.match(farmer, /activeProduceCategory === "all"/);
    assert.match(buyer, /input\.addEventListener\("input", filterProduceCards\)/);
    assert.match(buyer, /activeProduceCategory === "all"/);
});

test("all literal translation keys used by the six views are present and valid in three languages", () => {
    const document = {
        readyState: "loading",
        documentElement: { lang: "en" },
        querySelectorAll: () => [],
        addEventListener: () => {},
        dispatchEvent: () => {},
    };
    const window = {};
    vm.runInNewContext(read("frontend/js/i18n.js"), { document, window }, { filename: "i18n.js" });
    const translate = window.SmartFarmerI18n.translateKey;
    const files = [
        "backend/templates/public_produce.html", "backend/templates/farmer_dashboard.html",
        "backend/templates/buyer_dashboard.html", "backend/templates/public_profile.html",
        "frontend/js/public_produce.js", "backend/static/js/farmer_dashboard.js", "backend/static/js/buyer_dashboard.js",
    ];
    const keys = new Set();
    for (const file of files) {
        const source = read(file);
        for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?=["']([^"']+)["']/g)) {
            if (match[1].includes(".") && /^[a-z][a-z0-9_.]+$/i.test(match[1])) keys.add(match[1]);
        }
        for (const match of source.matchAll(/(?:t|translateKey|translatedNode|actionButton|emptyMarkup)\(\s*["'`]([a-z][a-z0-9_.]+)["'`]/g)) {
            if (match[1].includes(".")) keys.add(match[1]);
        }
    }
    assert.ok(keys.size > 100, `unexpectedly few translation keys collected: ${keys.size}`);
    for (const key of keys) {
        for (const locale of ["en", "si", "ta"]) {
            const value = translate(key, locale);
            assert.notEqual(value, key, `missing ${locale} translation for ${key}`);
            assert.doesNotMatch(value, /\?{2,}/, `question-mark placeholder in ${locale} translation for ${key}`);
        }
    }
});
