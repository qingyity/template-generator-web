import { inferTabularFields, MAX_TABULAR_FILE_SIZE, parseDelimited, parseXlsx } from "./data-import.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  templateId: null,
  master: null,
  zoom: 0.85,
  grfContent: "",
  config: null,
  ir: null,
  aiImage: null,
  sections: null,
  masterChanges: { detail: false, paper: false, style: false, query: false },
  previewMode: "visual",
  grhtml5Viewer: null,
  fields: [
    { name: "序号", label: "序号", type: "integer", width: 1.2, align: "center", visible: true },
    { name: "产品编码", label: "产品编码", type: "string", width: 2.8, align: "center", visible: true },
    { name: "品名", label: "品名", type: "string", width: 3.8, align: "left", visible: true },
    { name: "数量", label: "数量", type: "number", width: 1.8, align: "right", visible: true },
    { name: "单位", label: "单位", type: "string", width: 1.5, align: "center", visible: true },
  ],
};

const pages = {
  designer: ["模板设计", "配置字段与版式，实时预览并生成原生 GRF"],
  templates: ["模板库", "按分类管理模板与历史版本"],
  datasources: ["数据源", "维护 JSON 示例数据并自动识别字段"],
  batch: ["批量生成", "基于当前配置批量输出多个 GRF 模板"],
};

async function request(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = error ? "#b42318" : "#16213d";
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2200);
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}

function clearAiImage() {
  state.aiImage = null;
  $("#aiImage").value = "";
  $("#aiImageName").textContent = "可选，PNG / JPEG / WebP，最大 8MB";
  $("#aiImageClear").classList.add("hidden");
}

function switchView(name) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  $$(".view").forEach((item) => item.classList.remove("active"));
  $(`#${name}View`).classList.add("active");
  $("#pageTitle").textContent = pages[name][0];
  $("#pageSubtitle").textContent = pages[name][1];
  $(".toolbar").classList.toggle("hidden", name !== "designer");
  if (name === "templates") loadTemplates();
  if (name === "datasources") loadDataSources();
}

function renderFields() {
  const list = $("#fieldList");
  list.innerHTML = state.fields.map((field, index) => `
    <div class="field-row" draggable="true" data-index="${index}">
      <span class="drag">⠿</span>
      <input data-key="name" value="${escapeHtml(field.name)}" title="字段名" />
      <input data-key="label" value="${escapeHtml(field.label)}" title="显示标题" />
      <select data-key="type" title="类型">
        ${[["string","文本"],["integer","整数"],["number","数值"],["currency","金额"],["datetime","日期时间"],["boolean","布尔"]].map(([value,label]) => `<option value="${value}" ${field.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <input data-key="width" type="number" min="0.6" step="0.1" value="${field.width}" title="宽度(cm)" />
      <button class="remove" title="删除">×</button>
    </div>`).join("");
  $$(".field-row", list).forEach((row) => {
    $$('input,select', row).forEach((input) => input.addEventListener("input", () => {
      const key = input.dataset.key;
      state.fields[Number(row.dataset.index)][key] = key === "width" ? Number(input.value) : input.value;
      state.masterChanges.detail = true; scheduleGenerate();
    }));
    $(".remove", row).addEventListener("click", () => { state.fields.splice(Number(row.dataset.index), 1); state.masterChanges.detail = true; renderFields(); scheduleGenerate(); });
    row.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", row.dataset.index));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain")); const to = Number(row.dataset.index);
      const [moved] = state.fields.splice(from, 1); state.fields.splice(to, 0, moved); state.masterChanges.detail = true; renderFields(); scheduleGenerate();
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function parseRows() {
  try { const value = JSON.parse($("#sampleJson").value || "[]"); return Array.isArray(value) ? value : value.rows || []; }
  catch { return []; }
}

function currentConfig() {
  return {
    name: $("#templateName").value,
    title: $("#reportTitle").value,
    categoryId: Number($("#categorySelect").value) || null,
    dataSourceId: Number($("#dataSourceSelect").value) || null,
    paper: {
      size: $("#paperSize").value, orientation: $("#orientation").value,
      width: Number($("#paperWidth").value), height: Number($("#paperHeight").value),
      margins: { left: Number($("#marginLeft").value), top: Number($("#marginTop").value), right: Number($("#marginRight").value), bottom: Number($("#marginBottom").value) },
    },
    style: {
      fontFamily: $("#fontFamily").value, titleSize: Number($("#titleSize").value), headerSize: Number($("#headerSize").value), bodySize: Number($("#bodySize").value),
      headerBackground: $("#headerBackground").value, borderStyle: $("#borderStyle").value, borderWidth: Number($("#borderWidth").value), rowHeight: Number($("#rowHeight").value), zebra: $("#zebra").checked,
    },
    querySql: $("#querySql").value,
    fields: state.fields.map((field, order) => ({ ...field, visible: true, order })),
    sampleRows: parseRows(),
    sections: state.master ? null : state.sections,
    detailChanges: state.master ? state.masterChanges.detail : true,
    paperChanges: state.master ? state.masterChanges.paper : true,
    styleChanges: state.master ? state.masterChanges.style : true,
    queryChanges: state.master ? state.masterChanges.query : true,
    master: state.master,
  };
}

function applyConfig(config) {
  state.config = config; state.fields = config.fields || []; state.master = config.master || null; state.sections = config.sections || null;
  state.masterChanges = { detail: false, paper: false, style: false, query: false };
  $("#templateName").value = config.name || ""; $("#reportTitle").value = config.title || "";
  $("#categorySelect").value = config.categoryId || ""; $("#dataSourceSelect").value = config.dataSourceId || "";
  $("#paperSize").value = config.paper?.size || "A4"; $("#orientation").value = config.paper?.orientation || "landscape";
  $("#paperWidth").value = config.paper?.width || 21; $("#paperHeight").value = config.paper?.height || 29.7;
  for (const side of ["Left","Top","Right","Bottom"]) $(`#margin${side}`).value = config.paper?.margins?.[side.toLowerCase()] ?? 1.2;
  for (const key of ["fontFamily","titleSize","headerSize","bodySize","headerBackground","borderStyle","borderWidth","rowHeight"]) if (config.style?.[key] !== undefined) $(`#${key}`).value = config.style[key];
  $("#zebra").checked = Boolean(config.style?.zebra); $("#querySql").value = config.querySql || "";
  if (config.sampleRows?.length) $("#sampleJson").value = JSON.stringify(config.sampleRows, null, 2);
  $("#modeBadge").textContent = state.master ? "母版保真" : "从零生成";
  $("#modeHelp").textContent = state.master ? "保留导入模板的复杂报表头、脚本与控件，更新字段和纸张配置。" : "生成标准明细表结构，可直接在 Grid++Report 6.8 中打开。";
  $("#customPaper").classList.toggle("hidden", $("#paperSize").value !== "Custom");
  renderFields(); scheduleGenerate();
}

let generateTimer;
function scheduleGenerate() { clearTimeout(generateTimer); generateTimer = setTimeout(generate, 180); }

async function generate() {
  const config = currentConfig();
  if (!config.fields.length) return;
  try {
    const result = await request("/api/generate", { method: "POST", body: JSON.stringify({ config }) });
    state.grfContent = result.content; state.config = result.config;
    $("#grfCode").textContent = result.content.replace(/^\uFEFF/, ""); renderPreview(result.config);
    if (state.previewMode === "fidelity") renderHighFidelity(result.config);
  } catch (error) { toast(error.message, true); }
}

function renderHighFidelity(config = state.config || currentConfig()) {
  const holder = $("#grhtml5Holder");
  if (!window.rubylong?.grhtml5?.insertReportViewer) {
    holder.innerHTML = '<div class="fidelity-error">grhtml5 引擎未加载，可继续使用近似预览。</div>';
    return;
  }
  if (!state.grfContent) return;
  try {
    if (state.grhtml5Viewer) state.grhtml5Viewer.stop();
    holder.innerHTML = "";
    const report = JSON.parse(state.grfContent.replace(/^\uFEFF/, ""));
    const data = { recordset: (config.sampleRows || []).slice(0, 100) };
    state.grhtml5Viewer = window.rubylong.grhtml5.insertReportViewer("grhtml5Holder", report, data, {
      reportFitWidth: false,
      hoverEnabled: true,
      selectionHighlight: false,
    });
    state.grhtml5Viewer.start();
  } catch (error) {
    state.grhtml5Viewer = null;
    holder.innerHTML = `<div class="fidelity-error">高保真渲染失败：${escapeHtml(error.message)}。可切换回近似预览。</div>`;
  }
}

function renderPreview(config) {
  const rows = config.sampleRows?.length ? config.sampleRows.slice(0, 12) : [{}];
  const fields = config.fields.filter((field) => field.visible !== false);
  const landscape = config.paper.orientation === "landscape";
  const dimensions = config.paper.size === "Custom" ? [config.paper.width || 21, config.paper.height || 29.7] : config.paper.size === "A5" ? [14.8,21] : config.paper.size === "Letter" ? [21.59,27.94] : [21,29.7];
  const [width, height] = landscape ? [Math.max(...dimensions), Math.min(...dimensions)] : [Math.min(...dimensions), Math.max(...dimensions)];
  const paper = $("#paper"); paper.style.width = `${width * 37.8}px`; paper.style.minWidth = `${width * 37.8}px`; paper.style.minHeight = `${height * 37.8}px`; paper.style.transform = `scale(${state.zoom})`; paper.style.marginBottom = `${height * 37.8 * (state.zoom - 1)}px`;
  const border = config.style.borderStyle === "horizontal" ? `${config.style.borderWidth}px solid #323b4d` : `${config.style.borderWidth}px solid #323b4d`;
  paper.innerHTML = `<h2 class="paper-title" style="font-family:${escapeHtml(config.style.fontFamily)};font-size:${config.style.titleSize}px">${escapeHtml(config.title)}</h2>
    <table class="preview-table" style="font-family:${escapeHtml(config.style.fontFamily)};font-size:${config.style.bodySize}px"><colgroup>${fields.map((field) => `<col style="width:${field.width}cm">`).join("")}</colgroup><thead><tr>${fields.map((field) => `<th style="font-size:${config.style.headerSize}px;background:${config.style.headerBackground};border:${border}">${escapeHtml(field.label)}</th>`).join("")}</tr></thead><tbody class="${config.style.zebra ? "zebra" : ""}">${rows.map((row) => `<tr>${fields.map((field) => `<td style="height:${config.style.rowHeight}cm;text-align:${field.align};border:${border}">${escapeHtml(row[field.name] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table><div class="page-footer">第 1 页 / 共 1 页</div>`;
}

async function loadBootstrap() {
  const [categories, sources] = await Promise.all([request("/api/categories"), request("/api/data-sources")]);
  $("#categorySelect").innerHTML = `<option value="">未分类</option>${categories.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  $("#dataSourceSelect").innerHTML = `<option value="">临时数据</option>${sources.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
}

async function loadTemplates() {
  const templates = await request("/api/templates"); const root = $("#templateCards");
  root.innerHTML = templates.length ? templates.map((item) => `<article class="library-card"><span class="category-pill" style="background:${item.category_color || "#64748b"}">${escapeHtml(item.category_name || "未分类")}</span><h3>${escapeHtml(item.name)}</h3><p>Grid++Report 6.8 · 当前版本 v${item.current_version}</p><div class="meta"><span>${new Date(`${item.updated_at}Z`).toLocaleString()}</span><button class="button ghost" data-edit-template="${item.id}">继续编辑</button></div></article>`).join("") : `<div class="empty-card">还没有保存的模板，请先在模板设计中创建。</div>`;
  $$('[data-edit-template]', root).forEach((button) => button.addEventListener("click", async () => { const item = await request(`/api/templates/${button.dataset.editTemplate}`); state.templateId = item.id; applyConfig(item.config); switchView("designer"); }));
}

async function loadDataSources() {
  const sources = await request("/api/data-sources"); const root = $("#dataSourceCards");
  root.innerHTML = sources.length ? sources.map((item) => `<article class="library-card"><span class="category-pill" style="background:#53617c">${item.kind.toUpperCase()}</span><h3>${escapeHtml(item.name)}</h3><p>${item.fields.length} 个字段：${escapeHtml(item.fields.slice(0, 5).map((field) => field.name).join("、"))}</p><div class="meta"><span>${new Date(`${item.updated_at}Z`).toLocaleString()}</span><button class="button ghost" data-use-source="${item.id}">用于当前模板</button></div></article>`).join("") : `<div class="empty-card">还没有数据源。</div>`;
  $$('[data-use-source]', root).forEach((button) => button.addEventListener("click", async () => { const item = await request(`/api/data-sources/${button.dataset.useSource}`); state.fields = item.fields; if (item.kind === "json") $("#sampleJson").value = item.content; await loadBootstrap(); $("#dataSourceSelect").value = item.id; renderFields(); scheduleGenerate(); switchView("designer"); }));
}

function download(filename, content) { const blob = new Blob([content], { type: "application/octet-stream;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 500); }

function bindEvents() {
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  $$('[data-go-designer]').forEach((item) => item.addEventListener("click", () => switchView("designer")));
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => { $$(".tab").forEach((item) => item.classList.toggle("active", item === tab)); $$(".tab-page").forEach((item) => item.classList.toggle("active", item.dataset.page === tab.dataset.tab)); }));
  $$(".config-panel input,.config-panel select,.config-panel textarea").forEach((input) => input.addEventListener("input", scheduleGenerate));
  for (const id of ["paperSize", "orientation", "paperWidth", "paperHeight", "marginLeft", "marginTop", "marginRight", "marginBottom"]) $(`#${id}`).addEventListener("input", () => { state.masterChanges.paper = true; });
  for (const id of ["fontFamily", "titleSize", "headerSize", "bodySize", "headerBackground", "borderStyle", "borderWidth", "rowHeight", "zebra"]) $(`#${id}`).addEventListener("input", () => { state.masterChanges.style = true; });
  $("#querySql").addEventListener("input", () => { state.masterChanges.query = true; });
  $("#paperSize").addEventListener("change", () => $("#customPaper").classList.toggle("hidden", $("#paperSize").value !== "Custom"));
  $("#addField").addEventListener("click", () => { state.fields.push({ name: `字段${state.fields.length + 1}`, label: `字段${state.fields.length + 1}`, type: "string", width: 2.4, align: "center", visible: true }); state.masterChanges.detail = true; renderFields(); scheduleGenerate(); });
  $("#aiGenerate").addEventListener("click", async () => {
    const prompt = $("#aiPrompt").value.trim();
    if (!prompt && !state.aiImage) return toast("请填写文字或上传报表图片", true);
    const button = $("#aiGenerate");
    button.disabled = true; button.textContent = "正在生成…"; $("#aiResult").textContent = "";
    try {
      const result = await request("/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt, image: state.aiImage, provider: $("#aiProvider").value, model: $("#aiModel").value.trim() || undefined }) });
      state.ir = result.ir; state.templateId = null; state.master = null; state.grfContent = result.grf;
      applyConfig(result.config);
      const fellBack = result.meta.requestedProvider && result.meta.requestedProvider !== result.meta.provider;
      $("#aiResult").textContent = `${fellBack ? `⚠️ 未配置 ${result.meta.requestedProvider} 密钥，已回退本地 Mock · ` : ""}${result.meta.provider} · ${result.meta.model} · ${result.meta.mode} · 参考 ${result.meta.samples.length} 个样例`;
      if (fellBack) toast(`未配置 ${result.meta.requestedProvider} 密钥，本次使用本地 Mock`, true);
      const confirmationBox = $("#aiConfirmations");
      confirmationBox.classList.toggle("hidden", !result.confirmations?.length);
      confirmationBox.innerHTML = result.confirmations?.length ? `<b>生成前需确认</b>${result.confirmations.map((item) => `<div>• ${escapeHtml(item.message)}</div>`).join("")}` : "";
      toast("已通过 ReportIR 生成模板");
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; button.textContent = "生成 ReportIR 与模板"; }
  });
  $("#aiImage").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("仅支持 PNG、JPEG 或 WebP 图片");
      if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8MB");
      state.aiImage = await readImageFile(file);
      $("#aiImageName").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)}KB`;
      $("#aiImageClear").classList.remove("hidden");
    } catch (error) { clearAiImage(); toast(error.message, true); }
  });
  $("#aiImageClear").addEventListener("click", clearAiImage);
  $("#aiRevise").addEventListener("click", async () => {
    const prompt = $("#aiPrompt").value.trim();
    if (!prompt) return toast("请描述希望如何修改当前模板", true);
    await generate();
    const button = $("#aiRevise");
    button.disabled = true; button.textContent = "正在修改…"; $("#aiResult").textContent = "";
    try {
      const result = await request("/api/ai/revise", { method: "POST", body: JSON.stringify({ grf: state.grfContent, prompt, provider: $("#aiProvider").value, model: $("#aiModel").value.trim() || undefined }) });
      state.ir = result.ir; state.grfContent = result.grf;
      applyConfig(result.config);
      $("#aiResult").textContent = `${result.meta.provider} · 修改 ${result.diff.changeCount} 项`;
      toast("已在当前模板上应用迭代修改");
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; button.textContent = "在当前模板上迭代修改"; }
  });
  $("#inferFields").addEventListener("click", () => { const rows = parseRows(); if (!rows.length) return toast("请先填写有效的 JSON 数组", true); const first = rows[0]; state.fields = Object.entries(first).map(([name,value]) => ({ name, label:name, type:typeof value === "number" ? (Number.isInteger(value)?"integer":"number") : "string", width:Math.max(1.5,Math.min(5.5,name.length*.55+1.2)), align:typeof value === "number" ? "right":"center", visible:true })); state.masterChanges.detail = true; renderFields(); scheduleGenerate(); toast(`已识别 ${state.fields.length} 个字段`); });
  $("#tabularImport").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > MAX_TABULAR_FILE_SIZE) throw new Error("数据文件不能超过 5MB");
      const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
      if (![".csv", ".tsv", ".xlsx"].includes(extension)) throw new Error("仅支持 CSV、TSV 或 XLSX 文件");
      const { headers, rows } = extension === ".xlsx" ? parseXlsx(await file.arrayBuffer()) : parseDelimited(await file.text());
      state.fields = inferTabularFields(headers, rows);
      state.masterChanges.detail = true;
      $("#sampleJson").value = JSON.stringify(rows, null, 2);
      renderFields(); scheduleGenerate();
      toast(`已从 ${extension === ".xlsx" ? "Excel 首表" : extension.slice(1).toUpperCase()} 导入 ${rows.length} 行、${headers.length} 个字段`);
    } catch (error) { toast(error.message, true); }
    event.target.value = "";
  });
  $$("[data-preview]").forEach((button) => button.addEventListener("click", () => {
    state.previewMode = button.dataset.preview;
    $$("[data-preview]").forEach((item) => item.classList.toggle("active", item === button));
    $("#visualPreview").classList.toggle("hidden", state.previewMode !== "visual");
    $("#fidelityPreview").classList.toggle("hidden", state.previewMode !== "fidelity");
    $("#codePreview").classList.toggle("hidden", state.previewMode !== "code");
    if (state.previewMode === "fidelity") renderHighFidelity();
  }));
  $("#zoomIn").addEventListener("click", () => { state.zoom = Math.min(1.2,state.zoom+.05); $("#zoomValue").textContent=`${Math.round(state.zoom*100)}%`; renderPreview(state.config || currentConfig()); });
  $("#zoomOut").addEventListener("click", () => { state.zoom = Math.max(.45,state.zoom-.05); $("#zoomValue").textContent=`${Math.round(state.zoom*100)}%`; renderPreview(state.config || currentConfig()); });
  $("#copyGrf").addEventListener("click", async () => { await generate(); await navigator.clipboard.writeText(state.grfContent); toast("GRF 内容已复制"); });
  $("#downloadGrf").addEventListener("click", async () => { await generate(); download(`${currentConfig().name.replace(/[\\/:*?\"<>|]/g,"_")}.grf`, state.grfContent); });
  $("#grfImport").addEventListener("change", async (event) => { const file=event.target.files[0]; if(!file)return; try{const result=await request("/api/import-grf",{method:"POST",body:JSON.stringify({name:file.name.replace(/\.grf$/i,""),content:await file.text()})}); state.templateId=null; applyConfig(result.config); toast("已导入母版，复杂控件将保留");}catch(error){toast(error.message,true)} event.target.value=""; });
  $("#saveTemplate").addEventListener("click", async () => { try{const config=currentConfig(); const item=await request("/api/templates",{method:"POST",body:JSON.stringify({id:state.templateId,config,note:$("#versionNote").value})}); state.templateId=item.id; $("#versionNote").value=""; toast(`已保存版本 v${item.current_version}`);}catch(error){toast(error.message,true)} });
  $("#newTemplate").addEventListener("click", () => { state.templateId=null; state.master=null; applyConfig({name:"通用业务报表",title:"业务明细表",paper:{size:"A4",orientation:"landscape",margins:{left:1.2,top:1.2,right:1.2,bottom:1.2}},style:{fontFamily:"宋体",titleSize:18,headerSize:9,bodySize:9,headerBackground:"#eef2f7",borderStyle:"grid",borderWidth:.5,rowHeight:.78},fields:state.fields,sampleRows:parseRows()}); });
  $("#newDataSource").addEventListener("click", () => $("#dataSourceDialog").showModal());
  $("#dsKind").addEventListener("change", () => {
    for (const kind of ["Json", "Sqlite", "Mysql"]) $(`#ds${kind}Fields`).classList.toggle("hidden", $("#dsKind").value !== kind.toLowerCase());
  });
  $("#saveDataSourceButton").addEventListener("click", async (event) => { event.preventDefault(); try{const kind=$("#dsKind").value;const connection=kind==="sqlite"?{filename:$("#dsSqliteFilename").value}:kind==="mysql"?{host:$("#dsMysqlHost").value,port:Number($("#dsMysqlPort").value),user:$("#dsMysqlUser").value,password:$("#dsMysqlPassword").value,database:$("#dsMysqlDatabase").value}:undefined;await request("/api/data-sources",{method:"POST",body:JSON.stringify({name:$("#dsName").value,kind,content:$("#dsContent").value,connection})}); $("#dataSourceDialog").close(); await loadBootstrap(); loadDataSources(); toast("数据源已探测并保存");}catch(error){toast(error.message,true)} });
  $("#dataSourceSelect").addEventListener("change", async () => { if(!$("#dataSourceSelect").value)return; const item=await request(`/api/data-sources/${$("#dataSourceSelect").value}`); state.fields=item.fields; state.masterChanges.detail=true; if(item.kind==="json")$("#sampleJson").value=item.content; renderFields(); scheduleGenerate(); });
  $("#queryDataSource").addEventListener("click", async () => { try{const id=$("#dataSourceSelect").value;if(!id)throw new Error("请先选择 SQLite 或 MySQL 数据源");const item=await request(`/api/data-sources/${id}`);if(!["sqlite","mysql"].includes(item.kind))throw new Error("当前数据源不是数据库连接");const result=await request(`/api/data-sources/${id}/query`,{method:"POST",body:JSON.stringify({sql:$("#querySql").value})});state.fields=result.fields;state.masterChanges.detail=true;$("#sampleJson").value=JSON.stringify(result.rows,null,2);renderFields();scheduleGenerate();toast(`已填充 ${result.rows.length} 行预览数据`);}catch(error){toast(error.message,true)} });
  $("#runBatch").addEventListener("click", async () => { try{const items=JSON.parse($("#batchJson").value); const result=await request("/api/batch",{method:"POST",body:JSON.stringify({templateId:state.templateId,baseConfig:currentConfig(),items})}); const root=$("#batchResults"); root.classList.remove("empty"); root.innerHTML=result.outputs.map((item,index)=>`<div class="result-item"><span>${escapeHtml(item.filename)}</span><button data-download-batch="${index}">下载</button></div>`).join(""); $$('[data-download-batch]',root).forEach((button)=>button.addEventListener("click",()=>{const item=result.outputs[Number(button.dataset.downloadBatch)];download(item.filename,item.content)}));toast(`已生成 ${result.outputs.length} 个模板`);}catch(error){toast(error.message,true)} });
}

async function init() { try { await loadBootstrap(); bindEvents(); renderFields(); await generate(); } catch (error) { toast(error.message, true); console.error(error); } }
init();
