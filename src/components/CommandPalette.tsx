import { useEffect, useMemo, useRef, useState } from "react";

type CommandPaletteItem = {
  id: string;
  label: string;
  hint: string;
  disabled?: boolean;
  type?: "command" | "file";
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
};

// Subsequence fuzzy match: every query character must appear in order. Contiguous runs
// and early matches score higher, so "eh" ranks "导出 HTML" above scattered matches.
// Returns null when the query does not match at all.
function fuzzyScore(query: string, text: string): number | null {
  const target = text.toLowerCase();
  let score = 0;
  let cursor = 0;
  let run = 0;
  for (const char of query.toLowerCase()) {
    if (char === " ") continue;
    const index = target.indexOf(char, cursor);
    if (index === -1) return null;
    run = index === cursor ? run + 1 : 0;
    score += 1 + run + Math.max(0, 6 - index) * 0.15;
    cursor = index + 1;
  }
  return score;
}

export function CommandPalette({ open, query, items, onQueryChange, onClose }: CommandPaletteProps) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const visibleItems = useMemo(() => {
    const trimmed = query.trim();
    // Empty query shows only commands — workspace files would otherwise flood the list.
    if (!trimmed) return items.filter((item) => item.type !== "file");
    return items
      .map((item) => ({ item, score: fuzzyScore(trimmed, `${item.label} ${item.hint}`) }))
      .filter((entry): entry is { item: CommandPaletteItem; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => setSelected(0), [query, open]);

  const activeIndex = visibleItems.length === 0 ? -1 : Math.min(selected, visibleItems.length - 1);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  function runItem(item: CommandPaletteItem | undefined) {
    if (!item || item.disabled) return;
    item.run();
    onClose();
  }

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="搜索命令"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => (visibleItems.length === 0 ? 0 : (value + 1) % visibleItems.length));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) =>
                visibleItems.length === 0 ? 0 : (value - 1 + visibleItems.length) % visibleItems.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              runItem(visibleItems[activeIndex]);
            }
          }}
          placeholder="输入命令或文件名..."
        />
        <div className="command-list" aria-label="命令列表" ref={listRef}>
          {visibleItems.length > 0 ? (
            visibleItems.map((item, index) => (
              <button
                type="button"
                key={item.id}
                disabled={item.disabled}
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : undefined}
                onMouseMove={() => setSelected(index)}
                onClick={() => runItem(item)}
              >
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            ))
          ) : (
            <p>未找到命令。</p>
          )}
        </div>
      </section>
    </div>
  );
}
