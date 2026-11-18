import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bookmark, Search, Folder, Globe, ExternalLink, Copy, Trash2, FolderOpen, Star, Grid3X3, List, Download, Upload, X } from 'lucide-react';

interface ParsedBookmark {
  id: string;
  title: string;
  url: string;
  folder: string;
  folderPath: string[];
  addDate: string;
}

interface FolderNode {
  name: string;
  path: string[];
  count: number;
  children: Map<string, FolderNode>;
}

function isPublicHost(host: string): boolean {
  const h = (host || '').toLowerCase().trim();
  if (!h) return false;
  if (h === 'localhost') return false;
  if (h.endsWith('.local')) return false;
  if (!h.includes('.')) return false;
  if (h.startsWith('127.') || h.startsWith('192.168.') || h.startsWith('10.')) return false;
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return false;
  }
  return true;
}

function getFavicon(url: string) {
  try {
    const host = new URL(url).hostname;
    if (!isPublicHost(host)) return '';
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch { return ''; }
}
function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function decodeEntities(s: string): string {
  try {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  } catch {
    return s;
  }
}

function stripTags(s: string): string {
  return String(s || '').replace(/<[^>]*>/g, '');
}

function stableId(href: string, title: string): string {
  const s = href + '\n' + title;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return h.toString(36) + '-' + s.length.toString(36);
}

const BLOCKED_SCHEMES = /^\s*(javascript|data|vbscript):/i;
function isBlockedUrl(url: string): boolean {
  return BLOCKED_SCHEMES.test(String(url || ''));
}

function parseNetscapeBookmarks(html: string): { bookmarks: ParsedBookmark[]; folders: FolderNode } {
  const bookmarks: ParsedBookmark[] = [];
  const root: FolderNode = { name: 'All', path: [], count: 0, children: new Map() };
  // Простой и надёжный парсер: идём по порядку H3 и A, держим стек папок по DL глубине
  const tokens: { type: 'h3'|'a'|'dl'|'dl_end'; pos: number; data: any }[] = [];
  const h3Re = /<H3[^>]*>([\s\S]*?)<\/H3\s*>/gi;
  const aRe = /<A\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/A\s*>/gi;
  const dlRe = /<\/?DL[^>]*>/gi;
  let t: any;
  while ((t = h3Re.exec(html)) !== null) tokens.push({ type: 'h3', pos: t.index, data: t[1] });
  while ((t = aRe.exec(html)) !== null) tokens.push({ type: 'a', pos: t.index, data: { href: t[1] ?? t[2] ?? t[3] ?? '', title: t[4] } });
  while ((t = dlRe.exec(html)) !== null) tokens.push({ type: t[0].toLowerCase().startsWith('</') ? 'dl_end' : 'dl', pos: t.index, data: null });
  tokens.sort((a,b)=>a.pos-b.pos);

  let dlDepth = 0;
  const pathStack: string[] = [];

  function ensureFolder(path: string[]) {
    let cur = root;
    for (const seg of path) {
      if (!cur.children.has(seg)) cur.children.set(seg, { name: seg, path: [...cur.path, seg], count: 0, children: new Map() });
      cur = cur.children.get(seg)!;
    }
    return path;
  }

  for (const tok of tokens) {
    if (tok.type === 'dl') { dlDepth++; }
    else if (tok.type === 'dl_end') {
      dlDepth = Math.max(0, dlDepth - 1);
      if (pathStack.length > dlDepth) pathStack.length = dlDepth;
    }
    else if (tok.type === 'h3') {
      let name = decodeEntities(stripTags(String(tok.data))).trim();
      name = name.replace(/�/g,'').trim();
      if (!name) continue;
      // H3 лежит внутри DL глубины dlDepth, путь до неё = pathStack[0..dlDepth-2] + name
      pathStack.length = Math.max(0, dlDepth - 1);
      pathStack.push(name);
      ensureFolder([...pathStack]);
    }
    else if (tok.type === 'a') {
      const href = String(tok.data.href || '').trim();
      if (!href || isBlockedUrl(href)) continue;
      let title = decodeEntities(stripTags(String(tok.data.title || ''))).trim();
      title = title.replace(/�/g,'').trim();
      if (!title) title = getDomain(href);
      const folderPath = [...pathStack];
      const folder = folderPath[folderPath.length-1] || 'Unsorted';
      if (folderPath.length===0) ensureFolder(['Unsorted']);
      bookmarks.push({ id: stableId(href, title), title, url: href, folder, folderPath, addDate: '' });
      root.count++;
      let cur = root;
      for (const seg of folderPath) {
        const ch = cur.children.get(seg);
        if (ch) { ch.count++; cur = ch; }
      }
      if (folderPath.length===0) {
        let ch = root.children.get('Unsorted');
        if (!ch) { ch = { name:'Unsorted', path:['Unsorted'], count:0, children:new Map() }; root.children.set('Unsorted', ch); }
        ch.count++;
      }
    }
  }

  if (bookmarks.length===0) {
    const re2 = /<A\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/A\s*>/gi;
    let m; const seen=new Set<string>();
    while ((m = re2.exec(html)) !== null) {
      const href=String(m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!href || isBlockedUrl(href)) continue;
      let title=decodeEntities(stripTags(m[4] || '')).trim();
      if (seen.has(href)) continue; seen.add(href);
      bookmarks.push({ id: stableId(href, title || getDomain(href)), title: title||getDomain(href), url: href, folder:'Imported', folderPath:['Imported'], addDate:'' });
    }
    if (bookmarks.length) {
      root.children.set('Imported', { name:'Imported', path:['Imported'], count: bookmarks.length, children:new Map() });
      root.count=bookmarks.length;
    }
  }
  return { bookmarks, folders: root };
}

const folderIcons: Record<string, string> = {
  'Bug Bounty': 'text-pulse-red',
  'OSINT': 'text-pulse-accent',
  'Courses': 'text-pulse-green',
  'Pentest': 'text-pulse-orange',
  'Threat Hunting': 'text-pulse-yellow',
  'Cyber Security': 'text-pulse-red',
};

// Parse cache — повторное открытие страницы без перепарсинга большого HTML
let bmParseCache: { key: string; bookmarks: ParsedBookmark[]; folders: FolderNode } | null = null;
function bmCacheKey(html: string): string {
  return html.length + ':' + html.slice(0, 64) + ':' + html.slice(-64);
}

export default function BookmarksManager({ onNavigate, onNewTab }: { onNavigate: (url: string) => void; onNewTab?: (url: string) => void; }) {
  const [bookmarks, setBookmarks] = useState<ParsedBookmark[]>([]);
  const [root, setRoot] = useState<FolderNode | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid'|'list'>('grid');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      let html = '';
      // 1) try Electron IPC (читает C:\Desktop напрямую, мимо Tor)
      try {
        const api:any = (window as any).electronAPI;
        if (api?.bookmarksRead) {
          const r = await api.bookmarksRead();
          if (r?.ok && r.html) html = r.html;
        }
      } catch {}
      // 2) fallback fetch
      if (!html) {
        try {
          const r = await fetch('/bookmarks.html');
          if (r.ok) html = await r.text();
        } catch {}
      }
      if (!html) {
        try {
          const r = await fetch('/src/assets/bookmarks.html');
          if (r.ok) html = await r.text();
        } catch {}
      }
      if (!html) return;
      const key = bmCacheKey(html);
      if (bmParseCache && bmParseCache.key === key) {
        setBookmarks(bmParseCache.bookmarks);
        setRoot(bmParseCache.folders);
        return;
      }
      const { bookmarks: bks, folders } = parseNetscapeBookmarks(html);
      bmParseCache = { key, bookmarks: bks, folders };
      setBookmarks(bks);
      setRoot(folders);
    }
    load();
  }, []);

  const foldersList = useMemo(() => {
    if (!root) return [];
    const list: { name: string; path: string[]; count: number }[] = [];
    function collect(node: FolderNode) {
      if (node.name !== 'All') list.push({ name: node.name, path: node.path, count: node.count });
      for (const ch of node.children.values()) collect(ch);
    }
    collect(root);
    return list.sort((a,b)=> b.count - a.count);
  }, [root]);

  const filtered = useMemo(() => {
    let list = bookmarks;
    if (selectedFolder) list = list.filter(b => (b.folder || '') === selectedFolder || (b.folderPath || []).includes(selectedFolder));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b => {
        try {
          return (b.title || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q) || (b.folder || '').toLowerCase().includes(q);
        } catch {
          return false;
        }
      });
    }
    return list;
  }, [bookmarks, selectedFolder, search]);

  const displayed = filtered.slice(0, 300);

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(()=>setCopied(null), 1500);
  }

  function safeNavigate(url: string) {
    if (isBlockedUrl(url)) return;
    onNavigate(url);
  }

  function safeNewTab(url: string) {
    if (isBlockedUrl(url)) return;
    onNewTab?.(url);
  }

  return (
    <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><Bookmark className="text-pulse-accent" size={22}/> Закладки Firefox</h1>
          <p className="text-xs text-pulse-muted mt-1">{bookmarks.length} закладок • {foldersList.length} папок • импортировано с E:/trash/bookmarks_firefox.html</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setViewMode(viewMode==='grid'?'list':'grid')} className="p-2 rounded-lg bg-pulse-panel border border-pulse-border/60 text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panelHover transition-colors"><Grid3X3 size={16} className={viewMode==='grid'?'hidden':''}/><List size={16} className={viewMode==='list'?'hidden':''}/></button>
          <button onClick={async()=>{
            try{
              const api:any=(window as any).electronAPI;
              if (api?.bookmarksImportDialog) {
                const r=await api.bookmarksImportDialog();
                if (r?.ok && r.html) {
                  const {bookmarks:bks, folders}=parseNetscapeBookmarks(r.html);
                  setBookmarks(bks); setRoot(folders);
                }
              } else {
                const inp=document.createElement('input'); inp.type='file'; inp.accept='.html,.htm';
                inp.onchange=(e:any)=>{
                  const f=e.target.files[0]; if(!f) return;
                  const reader=new FileReader();
                  reader.onload=ev=>{
                    const html=String((ev.target as any).result||'');
                    const {bookmarks:bks,folders}=parseNetscapeBookmarks(html);
                    setBookmarks(bks); setRoot(folders);
                  };
                  reader.readAsText(f);
                };
                inp.click();
              }
            }catch{}
          }} className="flex items-center gap-1.5 px-3 py-2 bg-pulse-panel border border-pulse-border/60 rounded-lg text-xs text-pulse-textMuted hover:text-pulse-text hover:bg-pulse-panelHover transition-colors"><Upload size={14}/> Импорт</button>
          <button onClick={async()=>{
            const api:any=(window as any).electronAPI;
            const json=JSON.stringify(bookmarks, null, 2);
            if (api?.bookmarksExport) {
              await api.bookmarksExport(json, 'pulse-bookmarks.json');
            } else {
              const blob=new Blob([json],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='pulse-bookmarks.json'; a.click();
            }
          }} className="flex items-center gap-1.5 px-3 py-2 bg-pulse-accent/90 text-[#0A0A0C] rounded-lg text-xs font-semibold hover:bg-pulse-accentSoft transition-colors"><Download size={14}/> Экспорт</button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pulse-muted/60" />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по названию, URL, папке..." className="w-full pl-10 pr-9 py-2.5 bg-pulse-bgSoft/60 border border-pulse-border/60 rounded-xl text-sm text-pulse-text placeholder-pulse-muted/50 focus:border-pulse-accent/40 shadow-soft outline-none" />
          {search && <button onClick={()=>setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-md text-pulse-muted/70 hover:text-pulse-text hover:bg-pulse-panel/70 transition-colors"><X size={14}/></button>}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-pulse-muted font-mono tnum bg-pulse-panel/50 border border-pulse-border/40 rounded-full px-3">
          <Star size={12} className="text-pulse-yellow"/> {filtered.length} / {bookmarks.length}
        </div>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        <div className="w-64 flex-shrink-0 bg-pulse-surface/80 backdrop-blur-sm border border-pulse-border/50 rounded-xl shadow-soft overflow-hidden flex flex-col hidden md:flex">
          <div className="px-3 py-2.5 border-b border-pulse-border/50 flex items-center gap-2 text-[11px] font-semibold text-pulse-textMuted uppercase tracking-widest"><FolderOpen size={14} className="text-pulse-accentDim"/> Папки</div>
          <div className="overflow-auto flex-1 p-2 space-y-0.5">
            <button onClick={()=>setSelectedFolder(null)} className={`w-full text-left px-3 py-2 rounded-lg border border-transparent text-xs flex items-center justify-between transition-colors ${!selectedFolder?'bg-pulse-panel border-pulse-border/50 text-pulse-accentSoft font-medium':'hover:bg-pulse-panel/60 text-pulse-muted hover:text-pulse-text'}`}>
              <span className="flex items-center gap-2"><Globe size={12}/> Все</span><span className="font-mono tnum text-[10px] text-pulse-muted/60">{bookmarks.length}</span>
            </button>
            {foldersList.slice(0,40).map(f=>(
              <button key={f.path.join('/')} onClick={()=>setSelectedFolder(f.name)} className={`w-full text-left px-3 py-1.5 rounded-lg border border-transparent text-xs flex items-center justify-between truncate transition-colors ${selectedFolder===f.name?'bg-pulse-panel text-pulse-accentSoft border-pulse-border/60':'hover:bg-pulse-panel/60 text-pulse-muted hover:text-pulse-text'}`}>
                <span className="flex items-center gap-2 truncate"><Folder size={12} className={folderIcons[f.name]||'text-pulse-muted'}/><span className="truncate">{f.name}</span></span>
                <span className="font-mono tnum text-[10px] text-pulse-muted/60 ml-2">{f.count}</span>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-pulse-border/50">
            <div className="text-[10px] text-pulse-muted/50 font-mono tnum truncate">Импорт: E:\trash\bookmarks_firefox.html</div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {filtered.length===0 ? (
            <div className="h-full flex flex-col items-center justify-center text-pulse-muted py-20">
              <Bookmark size={32} className="opacity-20 mb-3"/>
              <div className="text-sm">Ничего не найдено</div>
              <div className="text-xs opacity-60">Попробуй другой запрос или папку</div>
            </div>
          ) : viewMode==='grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {displayed.map(b=>(
                <div key={b.id} className="cv-item group bg-pulse-surface/80 border border-pulse-border/50 rounded-xl p-3 hover:border-pulse-accent/25 hover:shadow-glow hover:-translate-y-0.5 transition-all flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <img src={getFavicon(b.url)} alt="" loading="lazy" decoding="async" className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0" onError={e=>(e.currentTarget.style.display='none')} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-pulse-text leading-tight truncate" title={b.title}>{b.title}</div>
                      <div className="text-[10px] text-pulse-muted/70 font-mono tnum truncate">{getDomain(b.url)}</div>
                    </div>
                    {copied===b.url && <span className="text-[10px] text-pulse-green">Скопировано</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-pulse-muted/80 bg-pulse-bgSoft/70 border border-pulse-border/30 rounded-lg px-2 py-1">
                    <Folder size={10}/><span className="truncate">{b.folder}</span>
                  </div>
                  <div className="flex gap-1 mt-auto">
                    <button onClick={()=>safeNavigate(b.url)} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-pulse-accent/90 text-[#0A0A0C] rounded-lg text-xs font-semibold hover:bg-pulse-accentSoft transition-colors"><ExternalLink size={12}/> Открыть</button>
                    <button onClick={()=>safeNewTab(b.url)} className="p-1.5 bg-pulse-panel/60 border border-pulse-border/50 rounded-lg text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panelHover transition-colors" title="Новая вкладка"><Globe size={12}/></button>
                    <button onClick={()=>copy(b.url)} className="p-1.5 bg-pulse-panel/60 border border-pulse-border/50 rounded-lg text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panelHover transition-colors" title="Копировать"><Copy size={12}/></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {displayed.map(b=>(
                <div key={b.id} className="flex items-center gap-3 p-2 bg-pulse-surface/70 border border-pulse-border/40 rounded-lg hover:bg-pulse-panel/50 hover:border-pulse-border/60 transition-colors">
                  <img src={getFavicon(b.url)} alt="" loading="lazy" decoding="async" className="w-4 h-4 rounded-sm flex-shrink-0" onError={e=>e.currentTarget.style.display='none'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-pulse-text truncate">{b.title}</div>
                    <div className="text-[10px] text-pulse-muted/70 font-mono tnum truncate">{b.url}</div>
                  </div>
                  <span className="hidden sm:inline text-[10px] text-pulse-muted bg-pulse-bgSoft/70 border border-pulse-border/30 px-2 py-1 rounded-full tnum">{b.folder}</span>
                  <button onClick={()=>safeNavigate(b.url)} className="p-1.5 rounded-md text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panel/70 transition-colors"><ExternalLink size={14}/></button>
                  <button onClick={()=>copy(b.url)} className="p-1.5 rounded-md text-pulse-muted hover:text-pulse-accentSoft hover:bg-pulse-panel/70 transition-colors"><Copy size={14}/></button>
                </div>
              ))}
            </div>
          )}
          {filtered.length>300 && <div className="text-center text-xs text-pulse-muted/60 tnum py-3">Показано 300 из {filtered.length} — уточни поиск</div>}
        </div>
      </div>
    </motion.div>
  );
}
