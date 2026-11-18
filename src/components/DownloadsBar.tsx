import { useState, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  ChevronUp,
  ChevronDown,
  X,
  File,
  FileText,
  FileArchive,
  FileCode,
  FolderOpen,
  Check,
  RotateCw,
  Trash2,
  Image as ImageIcon,
  Video,
  Music,
  Disc,
  Settings,
} from 'lucide-react';
import type { DownloadItem } from '../types';

interface DownloadsBarProps {
  downloads: DownloadItem[];
  onClear: () => void;
  onRemove: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, React.ReactNode> = {
    pdf: <FileText size={16} className="text-pulse-red" />,
    zip: <FileArchive size={16} className="text-pulse-yellow" />,
    rar: <FileArchive size={16} className="text-pulse-yellow" />,
    '7z': <FileArchive size={16} className="text-pulse-yellow" />,
    exe: <Settings size={16} className="text-pulse-muted" />,
    msi: <Settings size={16} className="text-pulse-muted" />,
    dmg: <Disc size={16} className="text-pulse-muted" />,
    iso: <Disc size={16} className="text-pulse-muted" />,
    mp4: <Video size={16} className="text-pulse-purple" />,
    mp3: <Music size={16} className="text-pulse-green" />,
    wav: <Music size={16} className="text-pulse-green" />,
    jpg: <ImageIcon size={16} className="text-pulse-accent" />,
    png: <ImageIcon size={16} className="text-pulse-accent" />,
    gif: <ImageIcon size={16} className="text-pulse-accent" />,
    svg: <ImageIcon size={16} className="text-pulse-accent" />,
    js: <FileCode size={16} className="text-pulse-yellow" />,
    py: <FileCode size={16} className="text-pulse-green" />,
    ts: <FileCode size={16} className="text-pulse-accent" />,
    html: <FileCode size={16} className="text-pulse-orange" />,
    css: <FileCode size={16} className="text-pulse-accent" />,
    txt: <FileText size={16} className="text-pulse-muted" />,
    md: <FileText size={16} className="text-pulse-muted" />,
    json: <FileText size={16} className="text-pulse-yellow" />,
    xml: <FileText size={16} className="text-pulse-yellow" />,
  };
  return map[ext] || <File size={16} className="text-pulse-muted" />;
}

const DownloadsBar = memo(function DownloadsBar({ downloads, onClear, onRemove }: DownloadsBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(true);

  const activeCount = useMemo(() => downloads.filter((d) => d.state === 'progressing').length, [downloads]);
  const completedCount = useMemo(() => downloads.filter((d) => d.state === 'completed').length, [downloads]);
  const activeProgress = useMemo(() => {
    if (activeCount === 0) return 0;
    return downloads
      .filter((d) => d.state === 'progressing')
      .reduce((sum, d) => sum + (d.totalBytes > 0 ? (d.receivedBytes / d.totalBytes) * 100 : 0), 0) / activeCount;
  }, [downloads, activeCount]);

  if (downloads.length === 0) return null;

  // Minimized: just a thin bar
  if (minimized) {
    return (
      <div className="flex items-center justify-between h-7 px-3 bg-pulse-bgSoft/80 backdrop-blur-sm border-t border-pulse-border/40 cursor-pointer hover:bg-pulse-panel/40 transition-colors liquid-bar"
        onClick={() => setMinimized(false)}
      >
        <div className="flex items-center gap-2 text-[11px] font-mono tnum text-pulse-muted">
          <Download size={12} className={activeCount > 0 ? 'text-pulse-accentDim animate-pulse' : 'text-pulse-muted/60'} />
          <span>
            {activeCount > 0 ? (
              <><span className="text-pulse-accentSoft">{activeCount}</span> downloading</>
            ) : (
              <>{completedCount} completed</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Mini progress for active downloads */}
          {activeCount > 0 && (
            <div className="w-24 h-[3px] bg-pulse-panel rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pulse-accentDim via-pulse-accent to-pulse-accentSoft rounded-full shadow-glow transition-all duration-300"
                style={{
                  width: `${activeProgress}%`,
                }}
              />
            </div>
          )}
          <ChevronUp size={12} className="text-pulse-muted/60" />
        </div>
      </div>
    );
  }

  // Expanded panel
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-pulse-surface/95 backdrop-blur-md border-t border-pulse-border/50 overflow-hidden liquid-bar"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-pulse-border/40">
        <div className="flex items-center gap-2">
          <Download size={14} className="text-pulse-accentDim" />
          <span className="text-xs font-semibold tracking-wide">Downloads</span>
          <span className="text-[10px] text-pulse-muted font-mono tnum">
            ({downloads.length} total, {activeCount} active)
          </span>
        </div>
        <div className="flex items-center gap-1">
          {completedCount > 0 && (
            <button
              onClick={onClear}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 rounded-lg transition-colors"
            >
              <Trash2 size={10} />
              Clear completed
            </button>
          )}
          <button
            onClick={() => setMinimized(true)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Download list */}
      <div className="max-h-48 overflow-auto">
        <AnimatePresence initial={false}>
          {downloads.map((dl) => {
            const progress = dl.totalBytes > 0 ? (dl.receivedBytes / dl.totalBytes) * 100 : 0;
            return (
              <motion.div
                key={dl.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3 px-4 py-2 border-b border-pulse-border/20 hover:bg-pulse-panel/40 transition-colors group"
              >
                <span className="flex-shrink-0 opacity-80">{getFileIcon(dl.filename)}</span>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-pulse-text truncate">{dl.filename}</span>
                    <span className="text-[10px] text-pulse-muted/70 font-mono tnum flex-shrink-0">
                      {formatBytes(dl.receivedBytes)}
                      {dl.totalBytes > 0 && ` / ${formatBytes(dl.totalBytes)}`}
                    </span>
                  </div>
                  {/* Progress bar */}
                  {dl.state === 'progressing' && (
                    <div className="mt-1.5 w-full h-[3px] bg-pulse-panel rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-pulse-accentDim via-pulse-accent to-pulse-accentSoft rounded-full shadow-glow transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                  {/* Status line */}
                  <div className="flex items-center gap-2 mt-0.5">
                    {dl.state === 'progressing' && (
                      <span className="text-[10px] text-pulse-accentSoft font-mono tnum">
                        {progress.toFixed(1)}%
                      </span>
                    )}
                    {dl.state === 'completed' && (
                      <span className="text-[10px] text-pulse-green font-mono tnum flex items-center gap-1">
                        <Check size={10} /> Completed
                      </span>
                    )}
                    {dl.state === 'cancelled' && (
                      <span className="text-[10px] text-pulse-red/80 font-mono tnum">Cancelled</span>
                    )}
                    <span className="text-[10px] text-pulse-muted/60 truncate">{dl.url}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {dl.state === 'completed' && (
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panel/70 transition-colors"
                      title="Open file"
                    >
                      <File size={12} />
                    </button>
                  )}
                  {dl.state === 'completed' && (
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panel/70 transition-colors"
                      title="Show in folder"
                    >
                      <FolderOpen size={12} />
                    </button>
                  )}
                  {dl.state === 'progressing' && (
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-yellow hover:bg-pulse-panel/70 transition-colors"
                      title="Retry"
                    >
                      <RotateCw size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => onRemove(dl.id)}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-pulse-muted hover:text-pulse-red hover:bg-pulse-red/10 transition-colors"
                    title="Remove"
                  >
                    <X size={12} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

export default DownloadsBar;
