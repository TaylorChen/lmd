type CommandPaletteItem = {
  id: string;
  label: string;
  hint: string;
  disabled?: boolean;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
};

export function CommandPalette({
  open,
  query,
  items,
  onQueryChange,
  onClose,
}: CommandPaletteProps) {
  if (!open) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (!normalizedQuery) return true;
    return `${item.label} ${item.hint}`.toLowerCase().includes(normalizedQuery);
  });

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
            }
            if (event.key === "Enter") {
              const firstEnabled = visibleItems.find((item) => !item.disabled);
              if (!firstEnabled) return;
              event.preventDefault();
              firstEnabled.run();
              onClose();
            }
          }}
          placeholder="输入命令..."
        />
        <div className="command-list" aria-label="命令列表">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={item.disabled}
                onClick={() => {
                  item.run();
                  onClose();
                }}
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
