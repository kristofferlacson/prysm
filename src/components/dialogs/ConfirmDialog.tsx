import { useEffect, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';

/**
 * The editor's own yes/no dialog (see askConfirm). It replaces the browser's confirm box, which
 * shows the site address, cannot be styled and blocks the whole page.
 */
export function ConfirmDialog() {
  const request = useUiStore((s) => s.confirm);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    // Capture phase: this dialog is always on top, so it answers Escape before anything under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      request.resolve(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [request]);

  if (!request) return null;
  return (
    <div
      className="ui-scale fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && request.resolve(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        data-testid="confirm-dialog"
        className="w-[380px] max-w-full rounded-lg border border-line bg-panel p-4 shadow-2xl shadow-black/60"
      >
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          {request.danger && <TriangleAlert size={15} className="text-danger" />}
          {request.title}
        </h2>
        <p className="mt-2 leading-relaxed text-dim">{request.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => request.resolve(false)}
            className="h-7 rounded bg-raised px-3 font-medium text-ink hover:bg-hover"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => request.resolve(true)}
            className={`h-7 rounded px-3 font-medium hover:brightness-110 ${
              request.danger ? 'bg-danger text-[#2a0606]' : 'bg-accent text-accent-ink'
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
