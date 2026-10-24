
export default function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/55 flex items-center justify-center z-50 p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-panel border border-border rounded-card w-full max-w-[520px] max-h-[85vh] overflow-y-auto p-5">
        <div className="flex justify-between items-center mb-3.5">
          <div className="text-base font-semibold">{title}</div>
          <div
            className="cursor-pointer text-muted hover:text-text text-xl leading-none"
            onClick={onClose}
          >
            ×
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
