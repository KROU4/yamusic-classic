// A small, safe YAML reader for LRCLIB's Lyricsfile (block mappings/sequences, quoted and block scalars,
// one-line flow collections). Pulling in a full YAML library for one document shape is not worth it,
// and this subset never executes tags or expands aliases (anchors/aliases stay plain text).
// Throws on input it cannot make sense of: callers treat that as "no word sync" and fall back.

const MAX_SIZE = 1024 * 1024; // a Lyricsfile is a few KB; anything bigger is not one

export function parseYaml(src) {
  if (typeof src !== "string") throw new Error("yaml: not a string");
  if (src.length > MAX_SIZE) throw new Error("yaml: too large");
  const rows = [];
  for (const raw of src.replace(/^﻿/, "").split(/\r?\n/)) {
    if (/^(---|\.\.\.)(\s|$)/.test(raw) || /^%/.test(raw)) continue; // document markers, directives
    if (/^\s*\t/.test(raw) && raw.trim()) throw new Error("yaml: tab indentation");
    const indent = raw.length - raw.trimStart().length;
    rows.push({ indent, text: raw.slice(indent), raw });
  }
  const st = { rows, i: 0 };
  const value = parseNode(st, -1);
  skipBlank(st);
  if (st.i < rows.length) throw new Error(`yaml: unexpected content at row ${st.i + 1}`);
  return value;
}

const isBlank = (row) => !row.text || row.text.startsWith("#");

function skipBlank(st) {
  while (st.i < st.rows.length && isBlank(st.rows[st.i])) st.i++;
}

const isSeqItem = (text) => text === "-" || text.startsWith("- ");

// key: plain (no leading indicator) or quoted, followed by ':' and a space or end of line
const KEY_RE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"{[\]},&*!|>%@`-][^#]*?|-[^\s#][^#]*?))\s*:(?:\s+|$)/;

function parseNode(st, parentIndent) {
  skipBlank(st);
  if (st.i >= st.rows.length) return null;
  const row = st.rows[st.i];
  if (row.indent <= parentIndent) return null;
  if (isSeqItem(row.text)) return parseSeq(st, row.indent);
  if (KEY_RE.test(row.text)) return parseMap(st, row.indent);
  // a bare scalar on its own row(s)
  const start = st.i++;
  return scalarWithContinuation(st, st.rows[start].text, row.indent - 1);
}

function parseSeq(st, indent) {
  const out = [];
  for (;;) {
    skipBlank(st);
    const row = st.rows[st.i];
    if (!row || row.indent !== indent || !isSeqItem(row.text)) break;
    const rest = row.text.slice(1).trimStart();
    if (!rest || rest.startsWith("#")) {
      st.i++;
      out.push(parseNode(st, indent));
      continue;
    }
    // "- key: v" / "- - x": re-read the rest of the row as a node indented past the dash
    const inner = indent + (row.text.length - rest.length);
    if (isSeqItem(rest) || KEY_RE.test(rest)) {
      st.rows[st.i] = { indent: inner, text: rest, raw: row.raw };
      out.push(isSeqItem(rest) ? parseSeq(st, inner) : parseMap(st, inner));
      continue;
    }
    st.i++;
    out.push(inlineValue(st, rest, indent));
  }
  return out;
}

function parseMap(st, indent) {
  const out = {};
  for (;;) {
    skipBlank(st);
    const row = st.rows[st.i];
    if (!row || row.indent !== indent) break;
    const m = row.text.match(KEY_RE);
    if (!m) {
      if (isSeqItem(row.text)) break;
      throw new Error(`yaml: expected a key at row ${st.i + 1}`);
    }
    const key = m[1] != null ? unescapeDouble(m[1]) : m[2] != null ? m[2].replace(/''/g, "'") : m[3].trim();
    const rest = row.text.slice(m[0].length);
    st.i++;
    let value;
    if (!rest || rest.startsWith("#")) {
      skipBlank(st);
      const next = st.rows[st.i];
      // "key:\n- item" — a sequence may sit at the same indent as its key
      if (next && next.indent === indent && isSeqItem(next.text)) value = parseSeq(st, indent);
      else value = parseNode(st, indent);
    } else value = inlineValue(st, rest, indent);
    if (key === "__proto__") continue; // never let a document touch the prototype
    out[key] = value;
  }
  return out;
}

/** Value written on the same row as its key or dash; may continue on more-indented rows. */
function inlineValue(st, text, ownerIndent) {
  if (/^[|>]/.test(text)) return blockScalar(st, text, ownerIndent);
  if (text[0] === "{" || text[0] === "[") {
    // flow collections may span rows: gather until brackets balance
    let src = text;
    while (!flowBalanced(src) && st.i < st.rows.length) src += " " + st.rows[st.i++].text;
    const p = { s: src, i: 0 };
    const v = parseFlow(p);
    const tail = src.slice(p.i).trim();
    if (tail && !tail.startsWith("#")) throw new Error("yaml: trailing flow content");
    return v;
  }
  return scalarWithContinuation(st, text, ownerIndent);
}

function scalarWithContinuation(st, text, ownerIndent) {
  if (text[0] === '"' || text[0] === "'") {
    let src = text;
    while (!quotedClosed(src) && st.i < st.rows.length) {
      const r = st.rows[st.i++];
      src += r.text ? " " + r.text : "\n";
    }
    const q = src[0];
    const end = closingQuote(src);
    if (end < 0) throw new Error("yaml: unterminated string");
    const body = src.slice(1, end).replace(/ ?\n ?/g, "\n");
    return q === '"' ? unescapeDouble(body) : body.replace(/''/g, "'");
  }
  // multi-line plain scalar: rows indented deeper than the owner fold into one line
  let out = stripComment(text);
  for (;;) {
    const r = st.rows[st.i];
    if (!r || (r.text && r.indent <= ownerIndent) || (r.text && r.text.startsWith("#"))) break;
    if (!r.text) {
      // a blank row ends the scalar unless more continuation follows
      let j = st.i;
      while (j < st.rows.length && !st.rows[j].text) j++;
      if (j >= st.rows.length || st.rows[j].indent <= ownerIndent) break;
      out += "\n";
      st.i = j;
      continue;
    }
    if (KEY_RE.test(r.text) || isSeqItem(r.text)) break;
    out += (out.endsWith("\n") ? "" : " ") + stripComment(r.text);
    st.i++;
  }
  return plainScalar(out);
}

function blockScalar(st, header, ownerIndent) {
  const folded = header[0] === ">";
  const chomp = /-/.test(header) ? "strip" : /\+/.test(header) ? "keep" : "clip";
  const lines = [];
  let indent = -1;
  while (st.i < st.rows.length) {
    const r = st.rows[st.i];
    if (r.raw.trim()) {
      if (r.indent <= ownerIndent) break;
      if (indent < 0) indent = r.indent;
      if (r.indent < indent) break;
      lines.push(r.raw.slice(indent));
    } else lines.push("");
    st.i++;
  }
  // trailing blank rows belong to the parent, not to the scalar
  let trail = 0;
  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
    trail++;
  }
  let body = folded ? lines.reduce((acc, l, k) => (k === 0 ? l : acc + (l === "" || lines[k - 1] === "" ? "\n" : " ") + l), "") : lines.join("\n");
  if (chomp === "clip" && lines.length) body += "\n";
  if (chomp === "keep") body += "\n".repeat(trail + (lines.length ? 1 : 0));
  return body;
}

function stripComment(text) {
  const k = text.search(/\s#/);
  return (k >= 0 ? text.slice(0, k) : text).trim();
}

function plainScalar(s) {
  const t = s.trim();
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^[-+]?(\d+|\d*\.\d+|\d+\.\d*)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function closingQuote(src) {
  const q = src[0];
  for (let k = 1; k < src.length; k++) {
    if (q === '"' && src[k] === "\\") k++;
    else if (src[k] === q) {
      if (q === "'" && src[k + 1] === "'") k++;
      else return k;
    }
  }
  return -1;
}

const quotedClosed = (src) => closingQuote(src) >= 0;

const ESC = { n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/", " ": " ", b: "\b", f: "\f", e: "\x1b", N: "\x85", _: "\xa0" };

function unescapeDouble(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) => {
    if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16));
    return ESC[e] ?? e;
  });
}

function flowBalanced(src) {
  let depth = 0;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'") {
      const end = closingQuote(src.slice(k));
      if (end < 0) return false;
      k += end;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return depth <= 0;
}

function parseFlow(p) {
  ws(p);
  const c = p.s[p.i];
  if (c === "{") {
    p.i++;
    const out = {};
    for (;;) {
      ws(p);
      if (p.s[p.i] === "}") {
        p.i++;
        return out;
      }
      const key = flowScalar(p, true);
      ws(p);
      let value = null;
      if (p.s[p.i] === ":") {
        p.i++;
        value = parseFlow(p);
      }
      if (key !== "__proto__") out[String(key)] = value;
      ws(p);
      if (p.s[p.i] === ",") p.i++;
      else if (p.s[p.i] !== "}") throw new Error("yaml: bad flow mapping");
    }
  }
  if (c === "[") {
    p.i++;
    const out = [];
    for (;;) {
      ws(p);
      if (p.s[p.i] === "]") {
        p.i++;
        return out;
      }
      out.push(parseFlow(p));
      ws(p);
      if (p.s[p.i] === ",") p.i++;
      else if (p.s[p.i] !== "]") throw new Error("yaml: bad flow sequence");
    }
  }
  return flowScalar(p, false);
}

function ws(p) {
  while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
}

function flowScalar(p, isKey) {
  const c = p.s[p.i];
  if (c === '"' || c === "'") {
    const rest = p.s.slice(p.i);
    const end = closingQuote(rest);
    if (end < 0) throw new Error("yaml: unterminated string");
    p.i += end + 1;
    const body = rest.slice(1, end);
    return c === '"' ? unescapeDouble(body) : body.replace(/''/g, "'");
  }
  const start = p.i;
  // a ':' ends a plain key only when followed by space/end (so "12:30" stays one value)
  while (p.i < p.s.length && !/[,\]}]/.test(p.s[p.i]) && !(isKey && p.s[p.i] === ":" && /[\s,\]}]|^$/.test(p.s[p.i + 1] ?? ""))) p.i++;
  if (p.i === start && !isKey) throw new Error("yaml: empty flow value");
  const raw = p.s.slice(start, p.i);
  return isKey ? raw.trim() : plainScalar(raw);
}
