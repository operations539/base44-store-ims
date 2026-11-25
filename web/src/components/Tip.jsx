import { useState } from 'react';

/**
 * Concise (?) help marker. Opens on hover, keyboard focus and tap so the same
 * hint works on the desktop console and the mobile PWA.
 */
export default function Tip({ text, label = 'More information' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="tip">
      <button
        type="button"
        className="tip-btn"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open ? (
        <span role="tooltip" className="tip-body">
          {text}
        </span>
      ) : null}
    </span>
  );
}
