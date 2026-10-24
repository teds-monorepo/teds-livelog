
const MINI_BTN =
  'absolute right-2 top-2 rounded-md border border-border bg-panel2 px-2 py-0.5 text-[10px] text-muted hover:text-text hover:border-accent';

/** A copyable code block — shared by the docs and server dialogs. */
export default function Code({ text, onCopy }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-bg px-3 py-2 pr-14 font-mono text-[11.5px] leading-relaxed text-accent2">
        {text}
      </pre>
      <button type="button" onClick={() => onCopy(text)} className={MINI_BTN}>
        Copy
      </button>
    </div>
  );
}
