// A dropdown that follows the site's ruled look (docs/design/10_visual_v3.md): the closed control is a row with the value and
// an orange chevron, the open list is square, hairline-ruled rows with an orange tick on the chosen one. A browser's own menu
// cannot be styled, so this is the combobox pattern (WAI-ARIA APG): focus stays on the button, the arrow keys move through the
// options (aria-activedescendant), Home and End jump, a letter jumps to the next option that starts with it, Enter or Space
// chooses, Escape and Tab close, a click outside closes. On phones the list opens inline, so the page just gets longer.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import styles from './dropdown.module.css';

export interface DropdownProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** [value, text] pairs; text may start with no-break spaces to indent a tree */
  options: [string, string][];
  /** the text of the empty choice, which clears the filter */
  any: string;
}

/** The index of the option a type-ahead word finds, starting after `from` for one letter (so a repeated letter cycles), or -1. */
function findAhead(all: [string, string][], text: string, at: number): number {
  const needle = text.length > 1 && [...text].every((ch) => ch === text[0]) ? text[0] : text;
  const from = at + (needle.length === 1 ? 1 : 0);
  const hit = [...all.slice(from), ...all.slice(0, from)].findIndex(([, label]) => label.trim().toLocaleLowerCase().startsWith(needle));
  return hit < 0 ? -1 : (from + hit) % all.length;
}

export function Dropdown({ id, label, value, onChange, options, any }: DropdownProps) {
  const all: [string, string][] = [['', any], ...options];
  const selected = Math.max(
    0,
    all.findIndex(([k]) => k === value),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const typed = useRef({ text: '', at: 0 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const choose = (i: number) => {
    onChange(all[i][0]);
    setOpen(false);
    button.current?.focus();
  };
  const move = (to: number) => setActive(Math.min(all.length - 1, Math.max(0, to)));

  // open: move the active option; closed: open the list, at the chosen option or at the given one
  const step = (to: number, from?: number) => {
    if (open) move(to);
    else if (from === undefined) show();
    else {
      setOpen(true);
      setActive(from);
    }
  };
  const typeAhead = (key: string) => {
    // letters typed within 500 ms make one word ("lik" finds "Like new"); one letter repeated cycles the options
    const now = Date.now();
    const c = key.toLocaleLowerCase();
    typed.current = { text: now - typed.current.at < 500 ? typed.current.text + c : c, at: now };
    const i = findAhead(all, typed.current.text, open ? active : selected);
    if (i < 0) return;
    if (open) setActive(i);
    else onChange(all[i][0]);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => step(active + 1),
      ArrowUp: () => step(active - 1),
      Home: () => step(0, 0),
      End: () => step(all.length - 1, all.length - 1),
      Enter: () => (open ? choose(active) : show()),
      ' ': () => (open ? choose(active) : show()),
    };
    if (e.key in keys) {
      e.preventDefault();
      keys[e.key]();
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(e.key);
  };

  return (
    <div className={styles.root} ref={root}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <button
        ref={button}
        type="button"
        id={id}
        className={styles.button}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span id={valueId}>{all[selected][1].trim()}</span>
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-labelledby={labelId} className={styles.list}>
          {all.map(([k, text], i) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the combobox pattern: the keys are heard by the button that keeps the focus (aria-activedescendant), the options only take the pointer
            <li
              key={k || 'any'}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              data-active={i === active || undefined}
              className={styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
