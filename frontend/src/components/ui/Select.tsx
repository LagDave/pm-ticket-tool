/**
 * Select - a custom, animated single-choice dropdown that replaces the native
 * <select> so its open menu matches the app's dark theme (the OS-rendered native
 * popup can't be styled). Presentational + self-contained: it owns only the
 * open/closed UI state (§15.2) and calls onChange with the chosen value; no fetch
 * or business logic (§14.1). Closes on outside click, Escape, or a pick. Generic
 * over the option value type so it stays reusable. Typed, no any (§17.2).
 */
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Accessible label for the trigger button. */
  ariaLabel?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  // Close on a click outside the component or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (next: T): void => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        className={"select-trigger" + (open ? " is-open" : "")}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{selected?.label ?? ""}</span>
        <ChevronDown size={16} className="select-caret shrink-0" aria-hidden />
      </button>
      {open && (
        <ul className="select-menu" role="listbox">
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={
                  "select-option" + (option.value === value ? " is-selected" : "")
                }
                onClick={() => pick(option.value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
