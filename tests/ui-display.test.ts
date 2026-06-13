import { describe, expect, test } from "vitest";
import { displayPath, redactedText, richTextHtml, threadLabel } from "../src/ui/display.js";

describe("UI display formatting", () => {
  test("removes user home prefixes from rendered paths and text", () => {
    expect(displayPath("/Users/bambozlor/Lab/Research-Desk/tmp-factory-testing/notion-lite/run")).toBe(
      "tmp-factory-testing/notion-lite/run"
    );
    expect(displayPath("/Users/bambozlor/Lab/Research-Desk/pi-factory")).toBe("pi-factory");
    expect(redactedText("Saved in /Users/bambozlor/Lab/Research-Desk/tmp-factory-testing/demo/PRD.md")).toBe(
      "Saved in tmp-factory-testing/demo/PRD.md"
    );
  });

  test("renders markdown-like run messages as safe structured HTML", () => {
    const html = richTextHtml(`# Architecture Brief\n\n## Stack\n- **Runtime:** Node.js\n- Path: \`/Users/bambozlor/Lab/Research-Desk/pi-factory\``);

    expect(html).toContain("<h2>Architecture Brief</h2>");
    expect(html).toContain("<h3>Stack</h3>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>Runtime:</strong>");
    expect(html).toContain("<code>pi-factory</code>");
    expect(html).not.toContain("/Users/bambozlor/");
  });

  test("escapes raw HTML before rendering rich text", () => {
    const html = richTextHtml("hello <script>alert('x')</script> **safe**");

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>safe</strong>");
    expect(html).not.toContain("<script>");
  });

  test("creates compact thread labels for dropdown selection", () => {
    expect(
      threadLabel({
        name: "Thread 95744d63-2e8f-4e66-9204-a30183e30330",
        participants: ["reviewer", "implementer", "architect"],
        messageCount: 3
      })
    ).toBe("Review thread - 3 messages - reviewer, implementer, architect");
    expect(
      threadLabel({
        name: "Architecture handoff",
        participants: ["planner", "architect"],
        messageCount: 2
      })
    ).toBe("Architecture handoff - 2 messages - planner, architect");
  });
});
