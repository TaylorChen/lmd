import { useEffect, useState } from "react";

export type NameDialogState = {
  title: string;
  label: string;
  defaultValue: string;
  confirmLabel: string;
};

type NameDialogProps = {
  state: NameDialogState | null;
  onCancel: () => void;
  onSubmit: (value: string) => void;
};

export function NameDialog({ state, onCancel, onSubmit }: NameDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(state?.defaultValue ?? "");
  }, [state]);

  if (!state) return null;

  return (
    <div className="name-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="name-dialog"
        role="dialog"
        aria-label={state.title}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const nextValue = value.trim();
          if (!nextValue) return;
          onSubmit(nextValue);
        }}
      >
        <header>
          <strong>{state.title}</strong>
        </header>
        <label>
          <span>{state.label}</span>
          <input
            autoFocus
            aria-label={state.label}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit" disabled={!value.trim()}>
            {state.confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
