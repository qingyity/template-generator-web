(() => {
  const STORAGE_KEY = "templateGenerator.site.v1";
  const nativeFetch = window.fetch.bind(window);

  function initialState() {
    const now = new Date().toISOString();
    return {
      counters: { category: 4, dataSource: 0, template: 0, version: 0 },
      categories: [
        { id: 1, name: "装箱单", color: "#2563eb", created_at: now },
        { id: 2, name: "入库单", color: "#059669", created_at: now },
        { id: 3, name: "运输单", color: "#d97706", created_at: now },
        { id: 4, name: "其他", color: "#64748b", created_at: now },
      ],
      dataSources: [],
      templates: [],
    };
  }

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return stored?.counters && Array.isArray(stored.categories) ? stored : initialState();
    } catch {
      return initialState();
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function inputBody(init) {
    if (!init?.body) return {};
    return typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  }

  function fieldsFromRows(rows) {
    const sample = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object").slice(0, 100) : [];
    const names = [...new Set(sample.flatMap((row) => Object.keys(row)))];
    return names.map((name, order) => {
      const values = sample.map((row) => row[name]).filter((value) => value !== null && value !== undefined && value !== "");
      const type = values.length && values.every((value) => Number.isInteger(value)) ? "integer"
        : values.length && values.every((value) => typeof value === "number") ? "number"
          : values.length && values.every((value) => typeof value === "boolean") ? "boolean" : "string";
      return { name, label: name, type, width: /名称|备注|说明/.test(name) ? 3.2 : 2.4, align: /integer|number/.test(type) ? "right" : "center", visible: true, order };
    });
  }

  function templateView(item) {
    return {
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      data_source_id: item.data_source_id,
      config_json: JSON.stringify(item.config),
      current_version: item.current_version,
      created_at: item.created_at,
      updated_at: item.updated_at,
      config: item.config,
      versions: item.versions.map(({ id, version, note, created_at }) => ({ id, version, note, created_at })).reverse(),
    };
  }

  async function localApi(path, init) {
    const method = (init?.method || "GET").toUpperCase();
    const state = load();
    const core = window.TemplateGeneratorSiteCore;

    if (method === "GET" && path === "/api/health") return json({ ok: true, product: "templateGenerator", grfVersion: "6.8.9.1", runtime: "browser" });
    if (method === "GET" && path === "/api/data-sources/providers") return json({ sqlite: { enabled: false }, mysql: { enabled: false }, storage: "browser-local" });
    if (core && method === "POST" && path === "/api/generate") return json(await core.generate(inputBody(init)));
    if (core && method === "POST" && path === "/api/import-grf") return json(await core.importGrf(inputBody(init)));
    if (core && method === "POST" && path === "/api/ai/generate") return json(await core.aiGenerate(inputBody(init)));
    if (core && method === "POST" && path === "/api/ai/revise") return json(await core.aiRevise(inputBody(init)));
    if (core && method === "POST" && path === "/api/batch") return json(await core.batch(inputBody(init)));

    if (path === "/api/categories" && method === "GET") {
      return json([...state.categories].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
    }
    if (path === "/api/categories" && method === "POST") {
      const input = inputBody(init);
      const name = String(input.name || "").trim();
      if (!name) return json({ error: "分类名称不能为空" }, 400);
      if (state.categories.some((item) => item.name === name)) return json({ error: "分类名称已存在" }, 409);
      const item = { id: ++state.counters.category, name, color: input.color || "#4f46e5", created_at: new Date().toISOString() };
      state.categories.push(item); save(state); return json(item, 201);
    }
    if (path === "/api/data-sources" && method === "GET") {
      return json([...state.dataSources].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(({ content, ...item }) => item));
    }
    if (path === "/api/data-sources" && method === "POST") {
      const input = inputBody(init);
      if (input.kind && input.kind !== "json") return json({ error: "公网托管版仅保存 JSON 数据源；SQLite/MySQL 直连需配置独立数据库服务" }, 400);
      let rows;
      try { rows = JSON.parse(input.content || "[]"); } catch { return json({ error: "JSON 数据格式错误" }, 400); }
      if (!Array.isArray(rows)) rows = rows.rows || [];
      const now = new Date().toISOString();
      const item = {
        id: ++state.counters.dataSource,
        name: String(input.name || "未命名数据源"), kind: "json", content: JSON.stringify(rows),
        fields: fieldsFromRows(rows), fields_json: JSON.stringify(fieldsFromRows(rows)), created_at: now, updated_at: now,
      };
      state.dataSources.push(item); save(state); return json(item, 201);
    }
    const dataSourceMatch = path.match(/^\/api\/data-sources\/(\d+)$/);
    if (dataSourceMatch && method === "GET") {
      const item = state.dataSources.find((entry) => entry.id === Number(dataSourceMatch[1]));
      return item ? json(item) : json({ error: "数据源不存在" }, 404);
    }
    if (/^\/api\/data-sources\/\d+\/query$/.test(path)) {
      return json({ error: "公网托管版不开放数据库直连" }, 400);
    }
    if (path === "/api/templates" && method === "GET") {
      return json([...state.templates].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((item) => {
        const category = state.categories.find((entry) => entry.id === item.category_id);
        const view = templateView(item);
        delete view.config; delete view.config_json; delete view.versions;
        return { ...view, category_name: category?.name || null, category_color: category?.color || null };
      }));
    }
    if (path === "/api/templates" && method === "POST") {
      const input = inputBody(init);
      const generated = core
        ? json(await core.generate({ config: input.config || input }))
        : await nativeFetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: input.config || input }) });
      const output = await generated.json();
      if (!generated.ok) return json(output, generated.status);
      const now = new Date().toISOString();
      let item = input.id ? state.templates.find((entry) => entry.id === Number(input.id)) : null;
      if (!item) {
        item = { id: ++state.counters.template, created_at: now, versions: [], current_version: 0 };
        state.templates.push(item);
      }
      item.name = output.config.name;
      item.category_id = output.config.categoryId || null;
      item.data_source_id = output.config.dataSourceId || null;
      item.config = output.config;
      item.current_version += 1;
      item.updated_at = now;
      item.versions.push({ id: ++state.counters.version, version: item.current_version, note: input.note || "", config: output.config, config_json: JSON.stringify(output.config), grf_content: output.content, created_at: now });
      save(state); return json(templateView(item), 201);
    }
    const versionMatch = path.match(/^\/api\/templates\/(\d+)\/versions\/(\d+)$/);
    if (versionMatch && method === "GET") {
      const item = state.templates.find((entry) => entry.id === Number(versionMatch[1]));
      const version = item?.versions.find((entry) => entry.version === Number(versionMatch[2]));
      return version ? json({ ...version, template_id: item.id }) : json({ error: "版本不存在" }, 404);
    }
    const templateMatch = path.match(/^\/api\/templates\/(\d+)$/);
    if (templateMatch && method === "GET") {
      const item = state.templates.find((entry) => entry.id === Number(templateMatch[1]));
      return item ? json(templateView(item)) : json({ error: "模板不存在" }, 404);
    }
    return null;
  }

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin === location.origin) {
      const response = await localApi(url.pathname, init);
      if (response) return response;
    }
    return nativeFetch(input, init);
  };
})();
