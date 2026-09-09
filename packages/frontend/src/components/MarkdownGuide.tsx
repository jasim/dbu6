type MarkdownBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function MarkdownGuide({ markdown }: { markdown: string }) {
  const blocks = parseGuideMarkdown(markdown);
  return (
    <div className="mt-4 rounded-md border bg-nested/40 p-4 text-sm">
      <div className="space-y-3">
        {blocks.map((block, index) => {
          if (block.kind === "heading") {
            return (
              <h2 key={index} className="font-semibold text-foreground">
                {renderInlineMarkdown(block.text)}
              </h2>
            );
          }
          if (block.kind === "list") {
            return (
              <ul
                key={index}
                className="list-disc space-y-1 pl-5 text-muted-foreground"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
                ))}
              </ul>
            );
          }
          return (
            <p key={index} className="text-muted-foreground">
              {renderInlineMarkdown(block.text)}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function parseGuideMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const paragraph: string[] = [];
  let list: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph.length = 0;
  }

  function flushList() {
    if (list.length === 0) return;
    blocks.push({ kind: "list", items: list });
    list = [];
  }

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushParagraph();
      list.push(trimmed.slice(2).trim());
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInlineMarkdown(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-background px-1 py-0.5 font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
