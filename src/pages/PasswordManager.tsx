import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key,
  Search,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Edit3,
  Check,
  Globe,
  RefreshCw,
  Shield,
  X,
  Sliders,
  StickyNote,
} from 'lucide-react';
import type { CredentialEntry } from '../types';

interface PasswordManagerProps {
  credentials: CredentialEntry[];
  onAdd: (entry: Omit<CredentialEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdate: (id: string, patch: Partial<CredentialEntry>) => void;
  onRemove: (id: string) => void;
}

function getFaviconUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=16`;
  } catch {
    return '';
  }
}

function generatePassword(length: number, options: {
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}): string {
  let chars = '';
  if (options.lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (options.uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.numbers) chars += '0123456789';
  if (options.symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
  if (!chars) chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  let password = '';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}

function getStrength(password: string): { label: string; color: string; percent: number } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 2) return { label: 'Weak', color: 'text-pulse-red', percent: 25 };
  if (score <= 3) return { label: 'Fair', color: 'text-pulse-yellow', percent: 50 };
  if (score <= 4) return { label: 'Good', color: 'text-pulse-orange', percent: 75 };
  return { label: 'Strong', color: 'text-pulse-green', percent: 100 };
}

export default function PasswordManager({
  credentials,
  onAdd,
  onUpdate,
  onRemove,
}: PasswordManagerProps) {
  const [query, setQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);

  // Form state
  const [formSite, setFormSite] = useState('');
  const [formSiteUrl, setFormSiteUrl] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Generator state
  const [genLength, setGenLength] = useState(20);
  const [genOptions, setGenOptions] = useState({
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  });
  const [generatedPassword, setGeneratedPassword] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return credentials;
    const q = query.toLowerCase();
    return credentials.filter(
      (c) =>
        c.site.toLowerCase().includes(q) ||
        c.siteUrl.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q)
    );
  }, [credentials, query]);

  const resetForm = () => {
    setFormSite('');
    setFormSiteUrl('');
    setFormUsername('');
    setFormPassword('');
    setFormNotes('');
    setEditingId(null);
    setShowAddDialog(false);
  };

  const handleSave = () => {
    if (!formSite.trim() || !formUsername.trim() || !formPassword.trim()) return;

    if (editingId) {
      onUpdate(editingId, {
        site: formSite.trim(),
        siteUrl: formSiteUrl.trim(),
        username: formUsername.trim(),
        password: formPassword,
        notes: formNotes.trim(),
        favicon: formSiteUrl.trim() ? getFaviconUrl(formSiteUrl.trim()) : null,
        updatedAt: new Date(),
      });
    } else {
      onAdd({
        site: formSite.trim(),
        siteUrl: formSiteUrl.trim(),
        username: formUsername.trim(),
        password: formPassword,
        notes: formNotes.trim(),
        favicon: formSiteUrl.trim() ? getFaviconUrl(formSiteUrl.trim()) : null,
      });
    }
    resetForm();
  };

  const handleEdit = (entry: CredentialEntry) => {
    setEditingId(entry.id);
    setFormSite(entry.site);
    setFormSiteUrl(entry.siteUrl);
    setFormUsername(entry.username);
    setFormPassword(entry.password);
    setFormNotes(entry.notes);
    setShowAddDialog(true);
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    setGeneratedPassword(generatePassword(genLength, genOptions));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Key className="text-pulse-accent" />
            Password Manager
          </h1>
          <p className="text-xs text-pulse-muted mt-1 tabular-nums">
            {credentials.length} saved credentials
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowGenerator(!showGenerator); handleGenerate(); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              showGenerator
                ? 'bg-pulse-accent/20 text-pulse-accent border border-pulse-accent/30'
                : 'bg-pulse-panel border border-pulse-border text-pulse-muted hover:text-pulse-text'
            }`}
          >
            <Sliders size={14} />
            Generator
          </button>
          <button
            onClick={() => { resetForm(); setShowAddDialog(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-pulse-accent text-pulse-bg rounded-xl text-xs font-semibold hover:bg-pulse-accentSoft active:scale-[0.98] transition-all"
          >
            <Plus size={14} />
            Add Password
          </button>
        </div>
      </div>

      {/* Password Generator Panel */}
      <AnimatePresence>
        {showGenerator && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-pulse-surface border border-pulse-border rounded-xl overflow-hidden"
          >
            <div className="p-4">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Sliders size={14} className="text-pulse-accent" />
                Password Generator
              </div>

              {/* Generated password display */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 px-3 py-2.5 bg-pulse-bg border border-pulse-border rounded-xl font-mono text-sm overflow-x-auto tabular-nums">
                  {generatedPassword || 'Click Generate'}
                </div>
                <button
                  onClick={() => generatedPassword && handleCopy(generatedPassword, 'gen')}
                  className="px-3 py-2.5 bg-pulse-panel border border-pulse-border rounded-lg text-xs hover:bg-pulse-panel/80 transition-colors"
                  title="Copy"
                >
                  {copiedId === 'gen' ? <Check size={14} className="text-pulse-green" /> : <Copy size={14} />}
                </button>
                <button
                  onClick={handleGenerate}
                  className="px-3 py-2.5 bg-pulse-panel border border-pulse-border rounded-lg text-xs hover:bg-pulse-panel/80 transition-colors"
                  title="Regenerate"
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {/* Strength indicator */}
              {generatedPassword && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className={`font-semibold ${getStrength(generatedPassword).color}`}>
                      {getStrength(generatedPassword).label}
                    </span>
                    <span className="text-pulse-muted">{generatedPassword.length} chars</span>
                  </div>
                  <div className="w-full h-1 bg-pulse-panel rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        getStrength(generatedPassword).percent <= 25 ? 'bg-pulse-red' :
                        getStrength(generatedPassword).percent <= 50 ? 'bg-pulse-yellow' :
                        getStrength(generatedPassword).percent <= 75 ? 'bg-pulse-orange' :
                        'bg-pulse-green'
                      }`}
                      style={{ width: `${getStrength(generatedPassword).percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-pulse-muted">Length:</label>
                  <input
                    type="range"
                    min={8}
                    max={64}
                    value={genLength}
                    onChange={(e) => setGenLength(Number(e.target.value))}
                    className="w-24 accent-pulse-accent"
                  />
                  <span className="text-xs font-mono w-6 text-center">{genLength}</span>
                </div>
                <div className="flex gap-3">
                  {([
                    ['lowercase', 'abc'],
                    ['uppercase', 'ABC'],
                    ['numbers', '123'],
                    ['symbols', '!@#'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={genOptions[key]}
                        onChange={(e) => setGenOptions({ ...genOptions, [key]: e.target.checked })}
                        className="accent-pulse-accent"
                      />
                      <span className="font-mono text-pulse-muted">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Use generated password button */}
              {generatedPassword && (
                <button
                  onClick={() => {
                    resetForm();
                    setFormPassword(generatedPassword);
                    setShowAddDialog(true);
                    setShowGenerator(false);
                  }}
                  className="mt-3 w-full py-2 bg-pulse-accent/10 text-pulse-accent border border-pulse-accent/30 rounded-lg text-xs font-medium hover:bg-pulse-accent/20 transition-colors"
                >
                  Use this password in new entry
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search passwords by site, URL, or username..."
          className="w-full pl-10 pr-4 py-2.5 bg-pulse-surface border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
        />
      </div>

      {/* Credentials List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-pulse-muted">
            <Key size={32} className="mx-auto mb-3 opacity-30" />
            <div className="text-sm">{query ? 'No matching passwords' : 'No saved passwords'}</div>
            <div className="text-xs mt-1 opacity-60">
              {query ? 'Try a different search' : 'Click "Add Password" to save your first credential'}
            </div>
          </div>
        ) : (
          filtered.map((entry) => {
            const isVisible = visiblePasswords.has(entry.id);
            const strength = getStrength(entry.password);
            return (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-pulse-surface border border-pulse-border rounded-xl p-4 hover:border-pulse-borderStrong transition-colors group"
              >
                <div className="flex items-start gap-4">
                  {/* Favicon */}
                  <div className="w-10 h-10 rounded-lg bg-pulse-bg border border-pulse-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {entry.favicon ? (
                      <img src={entry.favicon} alt="" className="w-6 h-6" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <Globe size={18} className="text-pulse-muted/40" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{entry.site}</span>
                      {entry.siteUrl && (
                        <span className="text-[10px] text-pulse-muted font-mono truncate">
                          {entry.siteUrl.replace(/^https?:\/\//, '').split('/')[0]}
                        </span>
                      )}
                    </div>

                    {/* Username */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] text-pulse-muted uppercase tracking-wider w-16">User</span>
                      <span className="text-xs font-mono">{entry.username}</span>
                      <button
                        onClick={() => handleCopy(entry.username, `user-${entry.id}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Copy username"
                      >
                        {copiedId === `user-${entry.id}` ? (
                          <Check size={12} className="text-pulse-green" />
                        ) : (
                          <Copy size={12} className="text-pulse-muted hover:text-pulse-text" />
                        )}
                      </button>
                    </div>

                    {/* Password */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-pulse-muted uppercase tracking-wider w-16">Pass</span>
                      <span className="text-xs font-mono flex-1">
                        {isVisible ? entry.password : '•'.repeat(Math.min(entry.password.length, 24))}
                      </span>
                      <button
                        onClick={() => togglePasswordVisibility(entry.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title={isVisible ? 'Hide' : 'Show'}
                      >
                        {isVisible ? (
                          <EyeOff size={12} className="text-pulse-muted hover:text-pulse-text" />
                        ) : (
                          <Eye size={12} className="text-pulse-muted hover:text-pulse-text" />
                        )}
                      </button>
                      <button
                        onClick={() => handleCopy(entry.password, `pass-${entry.id}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Copy password"
                      >
                        {copiedId === `pass-${entry.id}` ? (
                          <Check size={12} className="text-pulse-green" />
                        ) : (
                          <Copy size={12} className="text-pulse-muted hover:text-pulse-text" />
                        )}
                      </button>
                    </div>

                    {/* Strength + notes */}
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1.5">
                        <Shield size={10} className={strength.color} />
                        <span className={`text-[10px] font-mono ${strength.color}`}>{strength.label}</span>
                        <div className="w-12 h-1 bg-pulse-panel rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              strength.percent <= 25 ? 'bg-pulse-red' :
                              strength.percent <= 50 ? 'bg-pulse-yellow' :
                              strength.percent <= 75 ? 'bg-pulse-orange' :
                              'bg-pulse-green'
                            }`}
                            style={{ width: `${strength.percent}%` }}
                          />
                        </div>
                      </div>
                      {entry.notes && (
                        <span className="text-[10px] text-pulse-muted truncate max-w-[200px] flex items-center gap-1">
                          <StickyNote size={10} className="flex-shrink-0" /> {entry.notes}
                        </span>
                      )}
                      <span className="text-[10px] text-pulse-muted/50 ml-auto">
                        {entry.updatedAt.toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => handleEdit(entry)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-pulse-muted hover:text-pulse-accent hover:bg-pulse-panel transition-colors"
                      title="Edit"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => onRemove(entry.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-pulse-muted hover:text-pulse-red hover:bg-pulse-red/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Add/Edit Dialog */}
      <AnimatePresence>
        {showAddDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={resetForm}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md bg-pulse-surface border border-pulse-border rounded-2xl shadow-card p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Key size={14} className="text-pulse-accent" />
                  {editingId ? 'Edit Credential' : 'Add Credential'}
                </h3>
                <button onClick={resetForm} className="text-pulse-muted hover:text-pulse-text">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-pulse-muted uppercase tracking-wider block mb-1">Site name</label>
                  <input
                    type="text"
                    value={formSite}
                    onChange={(e) => setFormSite(e.target.value)}
                    placeholder="GitHub"
                    className="w-full px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-pulse-muted uppercase tracking-wider block mb-1">URL</label>
                  <input
                    type="text"
                    value={formSiteUrl}
                    onChange={(e) => setFormSiteUrl(e.target.value)}
                    placeholder="https://github.com"
                    className="w-full px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-pulse-muted uppercase tracking-wider block mb-1">Username / Email</label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-pulse-muted uppercase tracking-wider block mb-1">Password</label>
                  <div className="flex gap-2">
                    <input
                      type={visiblePasswords.has('form') ? 'text' : 'password'}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="••••••••"
                      className="flex-1 px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
                    />
                    <button
                      onClick={() => togglePasswordVisibility('form')}
                      className="px-3 py-2 bg-pulse-panel border border-pulse-border rounded-lg text-pulse-muted hover:text-pulse-text transition-colors"
                    >
                      {visiblePasswords.has('form') ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => {
                        const pw = generatePassword(genLength, genOptions);
                        setFormPassword(pw);
                        setGeneratedPassword(pw);
                      }}
                      className="px-3 py-2 bg-pulse-panel border border-pulse-border rounded-lg text-pulse-muted hover:text-pulse-accent transition-colors"
                      title="Generate password"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  {formPassword && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1 bg-pulse-panel rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            getStrength(formPassword).percent <= 25 ? 'bg-pulse-red' :
                            getStrength(formPassword).percent <= 50 ? 'bg-pulse-yellow' :
                            getStrength(formPassword).percent <= 75 ? 'bg-pulse-orange' :
                            'bg-pulse-green'
                          }`}
                          style={{ width: `${getStrength(formPassword).percent}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-mono ${getStrength(formPassword).color}`}>
                        {getStrength(formPassword).label}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[11px] text-pulse-muted uppercase tracking-wider block mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="2FA backup key, etc."
                    className="w-full px-3 py-2 bg-pulse-bg border border-pulse-border rounded-xl text-sm font-mono outline-none focus:border-pulse-accent/60 focus:ring-1 focus:ring-pulse-accent/30 transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button
                  onClick={resetForm}
                  className="flex-1 py-2.5 text-sm text-pulse-muted border border-pulse-border rounded-lg hover:bg-pulse-panel transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formSite.trim() || !formUsername.trim() || !formPassword.trim()}
                  className="flex-1 py-2.5 text-sm font-semibold bg-pulse-accent text-pulse-bg rounded-xl hover:bg-pulse-accentSoft active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
