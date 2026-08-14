const DELIMITERS = [",", "\t", ";"];
export const MAX_TABULAR_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_TABULAR_PREVIEW_ROWS = 100;

function delimiterScore(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

export function detectDelimiter(text) {
  const line = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  return DELIMITERS.map((delimiter) => [delimiter, delimiterScore(line, delimiter)])
    .sort((a, b) => b[1] - a[1])[0][0];
}

function parseCells(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV 存在未闭合的引号");
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function uniqueHeaders(cells) {
  const used = new Set();
  return Array.from(cells, (cell, index) => {
    const base = String(cell || "").trim() || `字段${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    return name;
  });
}

function typedValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^(是|否)$/.test(text)) return text === "是";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && !/^[-+]?0\d+/.test(text)) return Number(text);
  return text;
}

export function parseDelimited(text, options = {}) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  if (!source.trim()) throw new Error("CSV 文件为空");
  const delimiter = options.delimiter || detectDelimiter(source);
  const matrix = parseCells(source, delimiter);
  if (matrix.length < 2) throw new Error("CSV 至少需要表头和一行数据");
  const headers = uniqueHeaders(matrix[0]);
  const rows = matrix.slice(1, MAX_TABULAR_PREVIEW_ROWS + 1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, typedValue(cells[index])] )));
  return { delimiter, headers, rows };
}

function xlsxValue(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(/\.000Z$/, "Z");
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return typedValue(value);
}

export function parseXlsx(data, xlsx = globalThis.XLSX) {
  if (!xlsx?.read || !xlsx?.utils?.sheet_to_json) throw new Error("XLSX 离线解析器未加载");
  let workbook;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    workbook = xlsx.read(bytes, { type: "array", cellDates: true, dense: false });
  } catch (error) {
    throw new Error(`XLSX 解析失败：${error.message}`);
  }
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName || !workbook.Sheets?.[sheetName]) throw new Error("XLSX 不包含工作表");
  const matrix = Array.from(
    xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: false }),
    (row) => Array.from(row),
  ).filter((row) => row.some((value) => value !== "" && value !== null && value !== undefined));
  if (matrix.length < 2) throw new Error("XLSX 首个工作表至少需要表头和一行数据");
  const headers = uniqueHeaders(matrix[0]);
  const rows = matrix.slice(1, MAX_TABULAR_PREVIEW_ROWS + 1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, xlsxValue(cells[index])]),
  ));
  return { sheetName, headers, rows };
}

function fieldType(values) {
  const present = values.filter((value) => value !== "" && value !== null && value !== undefined);
  if (!present.length) return "string";
  if (present.every((value) => typeof value === "boolean")) return "boolean";
  if (present.every((value) => typeof value === "number")) return present.every(Number.isInteger) ? "integer" : "number";
  if (present.every((value) => typeof value === "string" && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T].*)?$/.test(value))) return "datetime";
  return "string";
}

export function inferTabularFields(headers, rows) {
  return headers.map((name, order) => {
    const type = fieldType(rows.map((row) => row[name]));
    return {
      name,
      label: name,
      type,
      width: Math.max(1.5, Math.min(5.5, name.length * 0.55 + 1.2)),
      align: ["integer", "number"].includes(type) ? "right" : "center",
      visible: true,
      order,
    };
  });
}
