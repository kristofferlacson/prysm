import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';

export function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useUiStore.getState().confirm && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="ui-scale fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-full flex-col rounded-lg border border-line bg-panel shadow-2xl shadow-black/60"
        style={{ width, maxWidth: '100%' }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-dim hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
