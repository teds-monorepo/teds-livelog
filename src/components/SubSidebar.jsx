
/**
 * The second sidebar in the app shell — a full-height context panel that sits
 * between the primary nav and the page content. See docs/DESIGN.md.
 */
export function SubSidebar({ title, action, children }) {
  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-panel2 border-r border-border px-3 py-5">
      <div className="flex items-center justify-between gap-2 px-2 pb-3">
        <div className="min-w-0 truncate text-[15px] font-semibold">{title}</div>
        {action}
      </div>
      <div className="flex flex-col gap-0.5 min-h-0 overflow-y-auto">{children}</div>
    </aside>
  );
}

export function SubItem({ active, onClick, icon, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-[9px] border ${
        active
          ? 'bg-accent/[0.14] border-accent/30 text-text'
          : 'border-transparent text-muted hover:text-text hover:bg-panel'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium truncate">{label}</span>
        {sub ? <span className="block text-[11px] text-muted truncate mt-0.5">{sub}</span> : null}
      </span>
    </button>
  );
}

/** Compact icon button used as a SubSidebar `action`. */
export function SubAction({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-7 h-7 flex-shrink-0 rounded-[7px] bg-panel border border-border text-muted hover:text-text hover:border-accent flex items-center justify-center text-[15px] leading-none"
    >
      {children}
    </button>
  );
}

/**
 * Scrollable, padded column that holds a page's main content.
 *
 * A page that manages its own scrolling (the Live Log console, which needs the
 * full height and no padding) turns both off. These are booleans rather than an
 * extra `className`, because a class appended afterwards can't reliably override
 * the base ones: Tailwind emits both rules at the same specificity, so which of
 * them wins comes down to stylesheet order rather than the order in the
 * attribute.
 */
export function ContentPane({ children, padded = true, scroll = true }) {
  return (
    <div
      className={`flex-1 min-w-0 ${scroll ? 'overflow-y-auto' : 'overflow-hidden'} ${
        padded ? 'px-6 py-7 pb-16' : ''
      }`}
    >
      {children}
    </div>
  );
}
