import { memo } from 'react';
import { X } from 'lucide-react';

export interface SavePasswordPromptProps {
  pending: { host: string; username: string } | null;
  onSave: () => void;
  onNever: () => void;
  onDismiss: () => void;
}

function SavePasswordPrompt({ pending, onSave, onNever, onDismiss }: SavePasswordPromptProps) {
  if (!pending) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-pulse-surface border-b border-pulse-border text-sm">
      <span className="text-pulse-muted truncate">
        Save password for <span className="text-pulse-text font-medium">{pending.host}</span>
        {pending.username ? <span> ({pending.username})</span> : null}?
      </span>
      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
        <button onClick={onSave} className="px-3 py-1 bg-pulse-accent text-pulse-bg rounded-lg text-xs font-semibold hover:bg-pulse-accent/90 transition-colors">Save</button>
        <button onClick={onNever} className="px-3 py-1 text-xs text-pulse-muted hover:text-pulse-text transition-colors">Never</button>
        <button onClick={onDismiss} className="px-2 py-1 text-pulse-muted hover:text-pulse-text transition-colors" title="Dismiss"><X size={14} /></button>
      </div>
    </div>
  );
}

export default memo(SavePasswordPrompt);
