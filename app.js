// FiveM Natives Mirror - no React, no build step.
// Loads JSON databases (local first, remote fallback), then renders a docs-like UI.
//
// Local cache files are recommended:
//   ./data/natives.json
//   ./data/natives_cfx.json
//
// Fetch them once:
//   node ./scripts/fetch-natives.mjs
//
// Run:
//   python -m http.server 5173
//   then open http://localhost:5173

const SOURCES = {
    gta: ["./data/natives.json", "https://runtime.fivem.net/doc/natives.json"],
    cfx: ["./data/natives_cfx.json", "https://runtime.fivem.net/doc/natives_cfx.json"],
};

const $ = (sel) => document.querySelector(sel);

const elStatus = $("#status");
const elList = $("#list");
const elDetail = $("#detail");
const elQ = $("#q");
const elApi = $("#apiset");
const elLang = $("#lang");
const elNs = $("#ns");

// markdown -> safe html
if (window.marked) {
    marked.setOptions({ gfm: true, breaks: true });
}

function mdBlock(s) {
    const text = (s ?? "").toString();
    if (!text) return "";
    if (window.marked && window.DOMPurify) {
        return DOMPurify.sanitize(marked.parse(text));
    }
    return escapeHtml(text).replaceAll("\n", "<br>");
}

function mdInline(s) {
    const text = (s ?? "").toString();
    if (!text) return "";
    if (window.marked && window.DOMPurify) {
        const html = marked.parseInline ? marked.parseInline(text) : marked.parse(text);
        return DOMPurify.sanitize(html);
    }
    return escapeHtml(text);
}

function escapeHtml(s) {
    return (s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function rawToPascal(raw) {
    if (!raw) return "";
    if (/^_?0x/i.test(raw)) return raw; // hash-style name, keep
    raw = raw.replace(/^_/, "");
    return raw
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((p) => p[0]?.toUpperCase() + p.slice(1))
        .join("");
}

function normalizeApiSet(n) {
    // apiset appears on many entries. If missing, assume 'client' (most GTA natives are client-side).
    return (n.apiset || "client").toLowerCase();
}

function toExamplesMap(examples) {
    // natives.json uses: [{ lang: "lua"|"js"|"cs", code: "..." }, ...]
    const m = new Map();
    if (!Array.isArray(examples)) return m;
    for (const ex of examples) {
        if (!ex) continue;
        if (typeof ex === "string") continue;
        const lang = (ex.lang || "").toLowerCase();
        if (!lang) continue;
        m.set(lang, ex.code || "");
    }
    return m;
}

function formatRawSignature(n) {
    const ret = n.results || "void";
    const name = n.name || "";
    const params = (n.params || []).map((p) => `${p.type || "Any"} ${p.name || "p"}`).join(", ");
    const comment = `// ${rawToPascal(name)}`;
    return `${comment}\n${ret} ${name}(${params});`;
}

function formatLuaSignature(n) {
    const name = rawToPascal(n.name || "");
    const params = (n.params || []).map((p) => p.name || "p").join(", ");
    const ret = (n.results && n.results !== "void") ? "local result = " : "";
    return `${ret}${name}(${params})`;
}

function formatCsSignature(n) {
    // We don't fully map types; we prefer examples when present.
    const name = rawToPascal(n.name || "");
    const params = (n.params || []).map((p) => `${p.type || "object"} ${p.name || "p"}`).join(", ");
    const ret = n.results || "void";
    return `${ret} ${name}(${params});`;
}

function formatJsSignature(n) {
    const name = rawToPascal(n.name || "");
    const params = (n.params || []).map((p) => p.name || "p").join(", ");
    return `${name}(${params});`;
}

async function fetchFirstOk(urls) {
    let lastErr;
    for (const url of urls) {
        try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error("Fetch failed");
}

function flatten(db) {
    const out = [];
    for (const [ns, entries] of Object.entries(db || {})) {
        for (const [hashKey, n0] of Object.entries(entries || {})) {
            const n = n0 || {};
            const hash = n.hash || hashKey;
            const name = n.name || "";
            const apiset = normalizeApiSet(n);
            const luaName = rawToPascal(name);
            const exMap = toExamplesMap(n.examples);
            const searchText = [
                name, luaName, hash, ns,
                n.description || "",
                (n.params || []).map((p) => `${p.name || ""} ${p.type || ""} ${p.description || ""}`).join(" "),
                n.results || "", n.resultsDescription || ""
            ].join("\n").toLowerCase();

            out.push({
                ...n,
                ns: n.ns || ns,
                hash,
                name,
                apiset,
                luaName,
                exMap,
                searchText,
            });
        }
    }
    return out;
}

function parseHashFragment() {
    const raw = (location.hash || "").trim();
    const m = raw.match(/^#_?(0x[0-9a-f]+)$/i);
    return m ? m[1] : null;
}

function parseDeepLink() {
    // 1) support official-style markdown links: href="#_0xABC..."
    const fromHash = parseHashFragment();
    if (fromHash) return fromHash;

    // 2) support official deep link: "?_0xABC=", this parses "_0xABC" to "0xABC"
    const url = new URL(location.href);
    for (const [k] of url.searchParams.entries()) {
        if (/^_?0x/i.test(k)) return k.replace(/^_/, "");
    }

    // 3) optional: "?hash=0xABC"
    const h = url.searchParams.get("hash");
    if (h && /^0x/i.test(h)) return h;

    return null;
}

function setDeepLink(hash) {
    const url = new URL(location.href);
    // clear existing hash-like keys
    for (const k of [...url.searchParams.keys()]) {
        if (/^_?0x/i.test(k) || k === "hash") url.searchParams.delete(k);
    }
    // keep the official style:
    url.searchParams.set(`_${hash}`, "");
    history.replaceState(null, "", url.toString());
}

function renderNsOptions(namespaces) {
    const current = elNs.value;
    const opts = ["all", ...namespaces].map((ns) => {
        const label = ns === "all" ? "Namespace: all" : `Namespace: ${ns}`;
        return `<option value="${escapeHtml(ns)}">${escapeHtml(label)}</option>`;
    }).join("");
    elNs.innerHTML = opts;
    if ([...elNs.options].some(o => o.value === current)) elNs.value = current;
}

function renderList(items, selectedHash) {
    const lang = elLang.value;
    const q = (elQ.value || "").trim().toLowerCase();

    const filtered = items.filter((n) => {
        if (elApi.value !== "all" && n.apiset !== elApi.value) return false;
        if (elNs.value !== "all" && n.ns !== elNs.value) return false;
        if (q && !n.searchText.includes(q)) return false;
        return true;
    });

    elStatus.textContent = `${filtered.length.toLocaleString()} natives (of ${items.length.toLocaleString()})`;

    const labelName = (n) => {
        switch (lang) {
            case "lua": return n.luaName || rawToPascal(n.name);
            case "cs": return rawToPascal(n.name);
            case "js": return rawToPascal(n.name);
            default: return n.name;
        }
    };

    elList.innerHTML = filtered.map((n) => {
        const active = (n.hash === selectedHash) ? "active" : "";
        const badge = `<span class="badge ${n.apiset}">${escapeHtml(n.apiset)}</span>`;
        return `
      <div class="item ${active}" data-hash="${escapeHtml(n.hash)}" role="option" aria-selected="${active ? "true" : "false"}">
        <div class="name">${escapeHtml(labelName(n))}</div>
        <div class="meta">
          ${badge}
          <span class="badge">${escapeHtml(n.ns)}</span>
          <span class="badge">${escapeHtml(n.hash)}</span>
        </div>
      </div>
    `;
    }).join("");

    elList.querySelectorAll(".item").forEach((node) => {
        node.addEventListener("click", () => {
            const hash = node.getAttribute("data-hash");
            if (!hash) return;
            setDeepLink(hash);
            renderDetail(items, hash);
            renderList(items, hash);
        });
    });
}

function renderCodeTabs(n, preferredLang) {
    const tabs = [
        { key: "raw", label: "raw", code: formatRawSignature(n) },
        { key: "lua", label: "lua", code: n.exMap.get("lua") || formatLuaSignature(n) },
        { key: "cs", label: "c#", code: n.exMap.get("cs") || formatCsSignature(n) },
        { key: "js", label: "js", code: n.exMap.get("js") || formatJsSignature(n) },
    ];

    let activeKey = preferredLang;
    if (!tabs.some(t => t.key === activeKey)) activeKey = "raw";

    const id = `tabs_${n.hash.replace(/[^a-z0-9]/ig, "")}`;

    const tabbar = tabs.map(t => `
    <button class="tab ${t.key === activeKey ? "active" : ""}" data-tab="${t.key}" data-target="${id}">
      ${escapeHtml(t.label)}
    </button>
  `).join("");

    const panes = tabs.map(t => `
    <pre class="pane" data-pane="${t.key}" style="display:${t.key === activeKey ? "block" : "none"};"><code>${escapeHtml(t.code || "")}</code></pre>
  `).join("");

    const html = `
    <div class="codeTabs" id="${id}">
      <div class="tabbar">${tabbar}</div>
      ${panes}
    </div>
  `;

    return html;
}

function renderDetail(items, hash) {
    // avoid case sensitive
    const n = items.find(
        (x) => (x.hash || "").toLowerCase() === (hash || "").toLowerCase()
    );
    if (!n) {
        elDetail.innerHTML = `
      <div class="empty">
        <h2>Native not found</h2>
        <p>Hash: <code>${escapeHtml(hash || "")}</code></p>
      </div>
    `;
        return;
    }

    const lang = elLang.value;

    const title = (lang === "raw") ? n.name : (lang === "lua" ? n.luaName : rawToPascal(n.name));
    const alt = (lang === "raw") ? n.luaName : n.name;

    const params = Array.isArray(n.params) ? n.params : [];
    const hasParams = params.length > 0;

    const paramsTable = !hasParams ? "<p class='empty'>No parameters.</p>" : `
    <table class="table">
      <thead>
        <tr><th>Name</th><th>Type</th><th>Description</th></tr>
      </thead>
      <tbody>
        ${params.map(p => `
          <tr>
            <td><code>${escapeHtml(p.name || "")}</code></td>
            <td><code>${escapeHtml(p.type || "")}</code></td>
            <td class="mdcell">${mdInline(p.description || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

    const returns = `
    <div>
      <div><code>${escapeHtml(n.results || "void")}</code></div>
      ${n.resultsDescription ? `<div class="desc md">${mdBlock(n.resultsDescription)}</div>` : ""}
    </div>
  `;

    const desc = (n.description || "").trim() || "(No description.)";

    elDetail.innerHTML = `
    <article class="detail">
      <h1>${escapeHtml(title || n.name)}</h1>
      <div class="kv">
        <span class="badge ${escapeHtml(n.apiset)}">${escapeHtml(n.apiset)}</span>
        <span class="badge">${escapeHtml(n.ns)}</span>
        <span class="badge"><code>${escapeHtml(n.hash)}</code></span>
        <span class="badge">alt: <code>${escapeHtml(alt)}</code></span>
      </div>

      <div class="section">
        <h2>Signature & examples</h2>
        ${renderCodeTabs(n, lang)}
      </div>

      <div class="section">
        <h2>Description</h2>
        <div class="desc md">${mdBlock(desc)}</div>
      </div>

      <div class="section">
        <h2>Parameters</h2>
        ${paramsTable}
      </div>

      <div class="section">
        <h2>Returns</h2>
        ${returns}
      </div>
    </article>
  `;

    // wire tab clicks
    elDetail.querySelectorAll(".tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-tab");
            const target = btn.getAttribute("data-target");
            const root = document.getElementById(target);
            if (!root) return;

            root.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
            root.querySelectorAll(".pane").forEach(p => {
                p.style.display = (p.getAttribute("data-pane") === key) ? "block" : "none";
            });
        });
    });
}

function unique(arr) {
    return [...new Set(arr)];
}

(async function main() {
    try {
        elStatus.textContent = "Loading natives… (local first, remote fallback)";
        const [gtaDb, cfxDb] = await Promise.all([
            fetchFirstOk(SOURCES.gta),
            fetchFirstOk(SOURCES.cfx),
        ]);

        const items = [
            ...flatten(gtaDb),
            ...flatten(cfxDb),
        ];

        // namespaces
        const namespaces = unique(items.map(n => n.ns).filter(Boolean)).sort((a, b) => a.localeCompare(b));
        renderNsOptions(namespaces);

        // Deep link on load
        const deeplink = parseDeepLink();
        if (deeplink) renderDetail(items, deeplink);

        renderList(items, deeplink);

        // controls
        const rerender = () => {
            const dl = parseDeepLink();
            renderList(items, dl);
            if (dl) renderDetail(items, dl);
        };

        elQ.addEventListener("input", () => {
            // debounce a little
            window.clearTimeout(elQ._t);
            elQ._t = window.setTimeout(rerender, 80);
        });
        elApi.addEventListener("change", rerender);
        elLang.addEventListener("change", rerender);
        elNs.addEventListener("change", rerender);

        window.addEventListener("popstate", () => {
            const dl = parseDeepLink();
            renderList(items, dl);
            if (dl) renderDetail(items, dl);
        });

    } catch (e) {
        console.error(e);
        elStatus.textContent = "Failed to load natives. See console for details.";
        elDetail.innerHTML = `
      <div class="empty">
        <h2>Load failed</h2>
        <p>This page prefers local cache files.</p>
        <ol>
          <li>Run <code>node ./scripts/fetch-natives.mjs</code></li>
          <li>Then serve the folder with <code>python -m http.server 5173</code></li>
        </ol>
      </div>
    `;
    }
})();
