// Fetch FiveM native JSON databases into ./data so the site can run offline.
// Requires Node 18+ (global fetch).

import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("./data");
await fs.mkdir(outDir, { recursive: true });

const files = [
    ["natives.json", "https://runtime.fivem.net/doc/natives.json"],
    ["natives_cfx.json", "https://runtime.fivem.net/doc/natives_cfx.json"],
];

for (const [name, url] of files) {
    console.log(`Downloading ${url}`);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const text = await res.text();
    const outPath = path.join(outDir, name);
    await fs.writeFile(outPath, text, "utf8");
    console.log(`Saved ${outPath} (${text.length.toLocaleString()} bytes)`);
}

console.log("Done.");
