import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://yanwu.test";

function worker() {
  const handlers = new Map();
  const stores = new Map();
  const network = [];
  const keyOf = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  let offline = false;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async (requests) => { requests.forEach((request) => {
          network.push({ url: keyOf(request), cache: request.cache });
          store.set(keyOf(request), new Response("current shell"));
        }); },
        match: async (request) => store.get(keyOf(request))?.clone(),
        put: async (request, response) => { store.set(keyOf(request), response); },
      };
    },
  };
  class BrowserRequest extends Request {
    constructor(url, options) { super(new URL(url, origin), options); }
  }
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    }, caches, Request: BrowserRequest, Response, URL,
    fetch: async (request, options) => {
      network.push({ url: request.url, ...options });
      if (offline) throw new Error("offline");
      return new Response(options.cache === "reload" ? "new release" : "asset");
    },
  });
  return {
    caches, stores, network,
    offline: () => { offline = true; },
    async lifecycle(name) {
      const pending = [];
      handlers.get(name)({ waitUntil: (promise) => pending.push(promise) });
      await Promise.all(pending);
    },
    async get(path, mode = "cors") {
      let response;
      const pending = [];
      handlers.get("fetch")({
        request: { method: "GET", url: new URL(path, origin).href, mode },
        respondWith: (promise) => { response = promise; },
        waitUntil: (promise) => pending.push(promise),
      });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test("upgrade fetches a fresh shell and removes only this app's old caches", async () => {
  const w = worker();
  const old = await w.caches.open("yanwu-shell-v1");
  await old.put("/api/v1/bootstrap", new Response("private old data"));
  await w.caches.open("other-app");
  await w.lifecycle("install");
  assert.ok(w.network.every((request) => request.cache === "reload"));
  await w.lifecycle("activate");
  assert.deepEqual(await w.caches.keys(), ["other-app", "yanwu-shell-v2"]);
});

test("navigation bypasses stale HTTP cache and saves the new page for offline use", async () => {
  const w = worker();
  assert.equal(await (await w.get("/learning", "navigate")).text(), "new release");
  assert.equal(w.network[0].cache, "reload");
  w.offline();
  assert.equal(await (await w.get("/learning", "navigate")).text(), "new release");
});

test("API and attachment requests bypass the worker, including while offline", async () => {
  const w = worker();
  await w.lifecycle("install");
  w.offline();
  for (const path of ["/api/v1/bootstrap", "/api/v1/attachments/test/download", "/attachments/test.pdf"]) {
    assert.equal(await w.get(path), undefined);
  }
  assert.equal(w.stores.get("yanwu-shell-v2").size, 2);
});

test("offline shell fallback is HTML only, never a missing JS or image", async () => {
  const w = worker();
  await w.lifecycle("install");
  w.offline();
  assert.equal(await (await w.get("/learning", "navigate")).text(), "current shell");
  assert.equal((await w.get("/assets/missing.js")).type, "error");
});

test("previously loaded hashed assets remain available offline", async () => {
  const w = worker();
  await w.get("/assets/app-hash.js");
  w.offline();
  assert.equal(await (await w.get("/assets/app-hash.js")).text(), "asset");
});
