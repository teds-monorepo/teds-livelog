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
