const researchDeskMarker = "/Lab/Research-Desk/";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function displayPath(value: string | null | undefined) {
  if (!value) return "workspace";
  const markerIndex = value.indexOf(researchDeskMarker);
  if (markerIndex >= 0) return value.slice(markerIndex + researchDeskMarker.length).replace(/^\/+/, "") || "Research-Desk";
  return value.replace(/^\/Users\/[^/]+\//, "").replace(/^\/+/, "") || "workspace";
}

export function redactedText(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replaceAll(/\/Users\/[^/\s]+\/Lab\/Research-Desk\/([^\s)`'"]+)/g, (_match, rest: string) => rest)
    .replaceAll(/\/Users\/[^/\s]+\//g, "");
}

function renderInline(value: string) {
  const escaped = escapeHtml(redactedText(value));
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function isDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableLine(line: string) {
  return line.includes("|") && !isDivider(line);
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(lines: string[]) {
  const [head, ...body] = lines.filter((line) => !isDivider(line));
  if (!head) return "";
  const header = tableCells(head)
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join("");
  const rows = body
    .map((line) => `<tr>${tableCells(line).map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="rich-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function flushParagraph(out: string[], paragraph: string[]) {
  if (paragraph.length === 0) return;
  out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  paragraph.length = 0;
}

function flushList(out: string[], list: string[]) {
  if (list.length === 0) return;
  out.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
  list.length = 0;
}

function flushTable(out: string[], table: string[]) {
  if (table.length === 0) return;
  out.push(renderTable(table));
  table.length = 0;
}

export function richTextHtml(value: string | null | undefined) {
  const text = redactedText(value ?? "").trim();
  if (!text) return "<p class=\"rich-empty\">No content.</p>";

  const out: string[] = [];
  const paragraph: string[] = [];
  const list: string[] = [];
  const table: string[] = [];
  const code: string[] = [];
  let inCode = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      flushParagraph(out, paragraph);
      flushList(out, list);
      flushTable(out, table);
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(redactedText(code.join("\n")))}</code></pre>`);
        code.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph(out, paragraph);
      flushList(out, list);
      flushTable(out, table);
      continue;
    }

    if (/^#{1,4}\s+/.test(trimmed)) {
      flushParagraph(out, paragraph);
      flushList(out, list);
      flushTable(out, table);
      const level = Math.min(4, trimmed.match(/^#+/)?.[0].length ?? 2) + 1;
      out.push(`<h${level}>${renderInline(trimmed.replace(/^#{1,4}\s+/, ""))}</h${level}>`);
      continue;
    }

    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph(out, paragraph);
      flushTable(out, table);
      list.push(listMatch[1] ?? "");
      continue;
    }

    if (isTableLine(trimmed) || (table.length > 0 && isDivider(trimmed))) {
      flushParagraph(out, paragraph);
      flushList(out, list);
      table.push(trimmed);
      continue;
    }

    flushList(out, list);
    flushTable(out, table);
    paragraph.push(trimmed);
  }

  flushParagraph(out, paragraph);
  flushList(out, list);
  flushTable(out, table);
  if (inCode) out.push(`<pre><code>${escapeHtml(redactedText(code.join("\n")))}</code></pre>`);

  return out.join("");
}

export function threadLabel(input: { name: string; participants: string[]; messageCount: number }) {
  const normalized = input.name.match(/^Thread\s+[0-9a-f-]{12,}$/i) ? "Review thread" : redactedText(input.name);
  const messageLabel = input.messageCount === 1 ? "1 message" : `${input.messageCount} messages`;
  const participants = input.participants.length ? input.participants.join(", ") : "no participants";
  return `${normalized} - ${messageLabel} - ${participants}`;
}
