import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, type = 'success') => {
    clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show };
}

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-6 right-6 z-20 px-3.5 py-2 rounded-lg text-[12.5px] bg-panel2 border ${
        toast.type === 'error' ? 'border-red-400/40 text-red-400' : 'border-accent2/40 text-accent2'
      }`}
    >
      {toast.message}
    </div>
  );
}
