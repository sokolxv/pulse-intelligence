import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

type NodeType = 'text' | 'sticky' | 'shape';

interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  rot?: number;
}

type ArrowType = 'arrow' | 'circle' | 'diamond' | 'none';

interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  arrowType: ArrowType;
}

const ARROW_TYPES: { type: ArrowType; label: string; icon: React.ReactNode }[] = [
  { type: 'arrow', label: 'Стрелка', icon: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { type: 'circle', label: 'Круг', icon: <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="12" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="2" y1="8" x2="9" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> },
  { type: 'diamond', label: 'Ромб', icon: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h6M10 5l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 5l2 3-2 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { type: 'none', label: 'Без наконечника', icon: <svg width="16" height="16" viewBox="0 0 16 16"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> },
];

interface Camera { x: number; y: number; scale: number; }
interface Interaction { type: string; [key: string]: any; }
interface PreviewLine { fromId: string; x: number; y: number; }

interface SavedCanvas {
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  createdAt: number;
  userId: string;
}

/* ─── Tokens ─── */
const ACCENT = '#EDEDF2';
const ACCENT_GLOW = 'rgba(245, 245, 247, 0.18)';
const CANVAS_BG = '#0A0A0C';
const DOT_COLOR = 'rgba(245, 245, 247, 0.05)';
const INK = '#EDEDF2';
const MUTED = '#71717B';
const SURFACE = '#141419';
const SURFACE_ELEVATED = '#1F1F26';
const BORDER = 'rgba(245, 245, 247, 0.1)';
const BORDER_HOVER = 'rgba(245, 245, 247, 0.22)';
const FILL_COLORS = ['#1F1F26', '#26262E', '#2E2E36', '#1A1A1F', '#232329', '#2B2B33'];
const SHAPE_COLORS = ['#F5F5F7', '#DBDBE0', '#A8A8B3', '#8E8E99', '#71717B', '#54545E'];
const TEXT_COLORS = ['#FFFFFF', '#EDEDF2', '#DBDBE0', '#A8A8B3', '#8E8E99', '#71717B'];
const TYPE_COLORS: Record<NodeType, string[]> = { text: TEXT_COLORS, sticky: FILL_COLORS, shape: SHAPE_COLORS };
const NODE_DEFAULTS: Record<NodeType, { w: number; h: number }> = { text: { w: 220, h: 56 }, sticky: { w: 200, h: 150 }, shape: { w: 220, h: 130 } };
const MIN_SCALE = 0.15, MAX_SCALE = 3;

let idCounter = 1;
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/* ─── Geometry ─── */
function screenToWorld(cx: number, cy: number, cam: Camera, r: DOMRect) {
  return { x: (cx - r.left - cam.x) / cam.scale, y: (cy - r.top - cam.y) / cam.scale };
}
function worldToScreen(p: { x: number; y: number }, cam: Camera) {
  return { x: p.x * cam.scale + cam.x, y: p.y * cam.scale + cam.y };
}
function routeEdge(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  let s: { x: number; y: number }, e: { x: number; y: number }, c1: { x: number; y: number }, c2: { x: number; y: number };
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) { s = { x: a.x + a.w, y: ac.y }; e = { x: b.x, y: bc.y }; } else { s = { x: a.x, y: ac.y }; e = { x: b.x + b.w, y: bc.y }; }
    const o = Math.max(Math.abs(e.x - s.x) / 2, 44);
    c1 = { x: s.x + (dx >= 0 ? o : -o), y: s.y }; c2 = { x: e.x - (dx >= 0 ? o : -o), y: e.y };
  } else {
    if (dy >= 0) { s = { x: ac.x, y: a.y + a.h }; e = { x: bc.x, y: b.y }; } else { s = { x: ac.x, y: a.y }; e = { x: bc.x, y: b.y + b.h }; }
    const o = Math.max(Math.abs(e.y - s.y) / 2, 44);
    c1 = { x: s.x, y: s.y + (dy >= 0 ? o : -o) }; c2 = { x: e.x, y: e.y - (dy >= 0 ? o : -o) };
  }
  return { start: s, end: e, c1, c2 };
}
function pathFromRoute(r: { start: { x: number; y: number }; c1: { x: number; y: number }; c2: { x: number; y: number }; end: { x: number; y: number } }) {
  return `M ${r.start.x},${r.start.y} C ${r.c1.x},${r.c1.y} ${r.c2.x},${r.c2.y} ${r.end.x},${r.end.y}`;
}
function midpointOfRoute(r: { start: { x: number; y: number }; c1: { x: number; y: number }; c2: { x: number; y: number }; end: { x: number; y: number } }) {
  return { x: 0.125 * (r.start.x + 3 * r.c1.x + 3 * r.c2.x + r.end.x), y: 0.125 * (r.start.y + 3 * r.c1.y + 3 * r.c2.y + r.end.y) };
}

/* ─── NodeView ─── */
function NodeView({ node, isSelected, isEditing, onMouseDownNode, onDoubleClickNode, onMouseDownAnchor, onMouseDownResize, onChangeText, onCommitEdit }: {
  node: CanvasNode; isSelected: boolean; isEditing: boolean;
  onMouseDownNode: (e: React.MouseEvent, node: CanvasNode) => void;
  onDoubleClickNode: (e: React.MouseEvent, node: CanvasNode) => void;
  onMouseDownAnchor: (e: React.MouseEvent, node: CanvasNode) => void;
  onMouseDownResize: (e: React.MouseEvent, node: CanvasNode) => void;
  onChangeText: (id: string, text: string) => void;
  onCommitEdit: () => void;
}) {
  const [hover, setHover] = useState(false);
  const showHandles = (hover || isSelected) && !isEditing;

  let cardStyle: React.CSSProperties = {};
  let textStyle: React.CSSProperties = { color: INK };

  if (node.type === 'text') {
    cardStyle = { background: hover || isSelected ? 'rgba(245,245,247,0.04)' : 'transparent', border: isSelected ? `1.5px dashed ${ACCENT}` : hover ? `1.5px dashed ${BORDER_HOVER}` : '1.5px dashed transparent', borderRadius: 8, display: 'flex', alignItems: 'center' };
    textStyle = { color: node.color, fontWeight: 600, fontSize: 20, lineHeight: '1.3', textAlign: 'center' };
  } else if (node.type === 'sticky') {
    cardStyle = { background: node.color, borderRadius: 14, boxShadow: isSelected ? `0 8px 24px rgba(0,0,0,0.5), 0 0 0 2px ${ACCENT}` : hover ? '0 8px 24px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.3)', transform: `rotate(${node.rot || 0}deg)`, display: 'flex', alignItems: 'flex-start', padding: 14 };
    textStyle = { color: '#EDEDF2', fontSize: 15, lineHeight: '1.45', fontWeight: 500 };
  } else if (node.type === 'shape') {
    cardStyle = { background: SURFACE_ELEVATED, border: `2px solid ${node.color}`, borderRadius: 12, boxShadow: isSelected ? `0 6px 20px rgba(0,0,0,0.4), 0 0 0 2px ${ACCENT}` : hover ? `0 6px 20px rgba(0,0,0,0.4), 0 0 0 1px ${BORDER_HOVER}` : '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 };
    textStyle = { color: INK, fontWeight: 600, fontSize: 15, textAlign: 'center', lineHeight: '1.35' };
  }

  const content = isEditing ? (
    <textarea autoFocus value={node.text} onChange={(e) => onChangeText(node.id, e.target.value)} onBlur={() => onCommitEdit()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onCommitEdit(); if (e.key === 'Enter' && node.type !== 'sticky' && !e.shiftKey) { e.preventDefault(); onCommitEdit(); } }}
      placeholder="Текст..."
      rows={node.type === 'sticky' ? 4 : 1}
      style={node.type === 'sticky'
        ? { width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', padding: 0, margin: 0, font: 'inherit', fontWeight: textStyle.fontWeight, fontSize: textStyle.fontSize, color: textStyle.color, textAlign: (textStyle.textAlign as any) || 'left', lineHeight: textStyle.lineHeight }
        : { width: '100%', height: 'auto', alignSelf: 'center', background: 'transparent', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', padding: 0, margin: 0, font: 'inherit', fontWeight: textStyle.fontWeight, fontSize: textStyle.fontSize, color: textStyle.color, textAlign: 'center', lineHeight: textStyle.lineHeight }}
    />
  ) : (
    <div style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', display: 'flex', alignItems: node.type === 'sticky' ? 'flex-start' : 'center', justifyContent: 'center', height: '100%', ...textStyle }}>
      {node.text || <span style={{ color: MUTED, fontWeight: 400, fontStyle: 'italic' }}>{node.type === 'text' ? 'Добавить текст...' : 'Пусто'}</span>}
    </div>
  );

  const anchors = [
    { dir: 'n', style: { top: -6, left: '50%', marginLeft: -6 } as React.CSSProperties },
    { dir: 's', style: { bottom: -6, left: '50%', marginLeft: -6 } as React.CSSProperties },
    { dir: 'w', style: { left: -6, top: '50%', marginTop: -6 } as React.CSSProperties },
    { dir: 'e', style: { right: -6, top: '50%', marginTop: -6 } as React.CSSProperties },
  ];

  return (
    <div className="cv-node" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => onMouseDownNode(e, node)} onDoubleClick={(e) => onDoubleClickNode(e, node)}
      style={{ position: 'absolute', left: node.x, top: node.y, width: node.w, height: node.h, cursor: isEditing ? 'text' : 'grab', borderRadius: node.type === 'sticky' ? 14 : node.type === 'shape' ? 12 : 8, transition: 'box-shadow 0.2s ease, border-color 0.2s ease' }}>
      <div style={{ width: '100%', height: '100%', boxSizing: 'border-box' as const, ...cardStyle }}>{content}</div>
      {showHandles && anchors.map((a) => (
        <div key={a.dir} className="cv-anchor" onMouseDown={(e) => onMouseDownAnchor(e, node)}
          style={{ position: 'absolute', width: 12, height: 12, borderRadius: 999, background: SURFACE, border: `2px solid ${ACCENT}`, cursor: 'crosshair', zIndex: 5, ...a.style }} />
      ))}
      {isSelected && !isEditing && (
        <div className="cv-resize" onMouseDown={(e) => onMouseDownResize(e, node)}
          style={{ position: 'absolute', right: -5, bottom: -5, width: 12, height: 12, borderRadius: 3, background: ACCENT, cursor: 'nwse-resize', zIndex: 5 }} />
      )}
    </div>
  );
}

/* ─── Small UI ─── */
function ToolbarBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (<button className="cv-tb-btn" onClick={onClick} title={title} style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: danger ? '#ef4444' : INK }}>{children}</button>);
}
function Divider() { return <div style={{ width: 1, height: 20, background: BORDER, margin: '0 2px' }} />; }

function NodeToolbar({ node, camera, onPickColor, onDuplicate, onDelete }: {
  node: CanvasNode; camera: Camera; onPickColor: (c: string) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const sp = worldToScreen({ x: node.x + node.w / 2, y: node.y }, camera);
  const colors = TYPE_COLORS[node.type] || FILL_COLORS;
  return (
    <div className="cv-node-toolbar" style={{ position: 'absolute', left: sp.x, top: sp.y - 14, transform: 'translate(-50%, -100%)', display: 'flex', alignItems: 'center', gap: 6, background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', padding: '6px 8px', zIndex: 20 }}>
      {colors.map((c) => (<button key={c} className="cv-swatch" onClick={() => onPickColor(c)} style={{ width: 16, height: 16, borderRadius: 999, background: c, border: node.color === c ? `2px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.06)', cursor: 'pointer', padding: 0 }} title="Цвет" />))}
      <Divider />
      <ToolbarBtn title="Дублировать" onClick={onDuplicate}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></ToolbarBtn>
      <ToolbarBtn title="Удалить" onClick={onDelete} danger><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></ToolbarBtn>
    </div>
  );
}

/* ─── Main ─── */
export default function CanvasBoard({ ownerId, storageKey }: { ownerId: string; storageKey: string }) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewLine, setPreviewLine] = useState<PreviewLine | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoomAnimating, setZoomAnimating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [savedCanvases, setSavedCanvases] = useState<SavedCanvas[]>([]);
  const [currentCanvasId, setCurrentCanvasId] = useState<string | null>(null);
  const [currentCanvasName, setCurrentCanvasName] = useState('');
  const [selectionBox, setSelectionBox] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction>({ type: 'none' });
  const nodesRef = useRef(nodes);
  const cameraRef = useRef(camera);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { cameraRef.current = camera; }, [camera]);

  useEffect(() => {
    setNodes([]);
    setEdges([]);
    setCamera({ x: 0, y: 0, scale: 1 });
    setSelectedIds(new Set());
    setSelectedEdgeId(null);
    setEditingId(null);
    setPreviewLine(null);
    setHoveredEdgeId(null);
    setShowHistory(false);
    setCurrentCanvasId(null);
    setCurrentCanvasName('');
    setSelectionBox(null);
    interactionRef.current = { type: 'none' };
    setSavedCanvases(loadSavedCanvases());
    setLoaded(true);
  }, [ownerId, storageKey]);

  function loadSavedCanvases(): SavedCanvas[] {
    try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw).filter((c: SavedCanvas) => c.userId === ownerId) : []; } catch { return []; }
  }
  function saveCanvasesToStorage(list: SavedCanvas[]) {
    try {
      const all = JSON.parse(localStorage.getItem(storageKey) || '[]').filter((c: SavedCanvas) => c.userId !== ownerId);
      localStorage.setItem(storageKey, JSON.stringify([...all, ...list]));
    } catch {}
  }

  const saveCurrentCanvas = useCallback(() => {
    const name = currentCanvasName.trim() || `Canvas ${savedCanvases.length + 1}`;
    if (currentCanvasId) {
      const updated = savedCanvases.map((c) => c.id === currentCanvasId ? { ...c, name, nodes, edges } : c);
      setSavedCanvases(updated); saveCanvasesToStorage(updated); setCurrentCanvasName(name);
    } else {
      const id = genId('cv');
      const nc: SavedCanvas = { id, name, nodes, edges, createdAt: Date.now(), userId: ownerId };
      const updated = [nc, ...savedCanvases];
      setSavedCanvases(updated); saveCanvasesToStorage(updated); setCurrentCanvasId(id); setCurrentCanvasName(name);
    }
  }, [nodes, edges, currentCanvasId, currentCanvasName, savedCanvases]);

  const loadCanvas = useCallback((id: string) => {
    const c = savedCanvases.find((x) => x.id === id); if (!c) return;
    setNodes(c.nodes); setEdges(c.edges); setCurrentCanvasId(id); setCurrentCanvasName(c.name);
    setSelectedIds(new Set()); setSelectedEdgeId(null); setEditingId(null); setCamera({ x: 0, y: 0, scale: 1 }); setShowHistory(false);
  }, [savedCanvases]);

  const deleteCanvas = useCallback((id: string) => {
    const updated = savedCanvases.filter((c) => c.id !== id);
    setSavedCanvases(updated); saveCanvasesToStorage(updated);
    if (currentCanvasId === id) { setCurrentCanvasId(null); setCurrentCanvasName(''); setNodes([]); setEdges([]); }
  }, [savedCanvases, currentCanvasId]);

  const newCanvas = useCallback(() => {
    setNodes([]); setEdges([]); setCurrentCanvasId(null); setCurrentCanvasName('');
    setSelectedIds(new Set()); setSelectedEdgeId(null); setEditingId(null); setCamera({ x: 0, y: 0, scale: 1 }); setShowHistory(false);
  }, []);

  const deleteNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSelectedIds((s) => { const next = new Set(s); next.delete(id); return next; });
    if (editingId === id) setEditingId(null);
  }, [editingId]);

  const deleteNodes = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setNodes((ns) => ns.filter((n) => !idSet.has(n.id)));
    setEdges((es) => es.filter((e) => !idSet.has(e.from) && !idSet.has(e.to)));
    setSelectedIds(new Set());
    setEditingId(null);
  }, []);

  const deleteEdge = useCallback((id: string) => { setEdges((es) => es.filter((e) => e.id !== id)); setSelectedEdgeId((s) => (s === id ? null : s)); }, []);

  const duplicateNode = useCallback((id: string) => {
    setNodes((ns) => { const n = ns.find((x) => x.id === id); if (!n) return ns; const copy = { ...n, id: genId(n.type[0]), x: n.x + 28, y: n.y + 28 }; setSelectedIds(new Set([copy.id])); return [...ns, copy]; });
  }, []);

  const duplicateSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const idMap = new Map<string, string>();
    const copies: CanvasNode[] = [];
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id); if (!n) continue;
      const newId = genId(n.type[0]); idMap.set(id, newId);
      copies.push({ ...n, id: newId, x: n.x + 28, y: n.y + 28 });
    }
    setNodes((ns) => [...ns, ...copies]);
    setSelectedIds(new Set(copies.map((c) => c.id)));
  }, [nodes, selectedIds]);

  const setEdgeArrowType = useCallback((id: string, arrowType: ArrowType) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, arrowType } : e)));
  }, []);

  const setNodeColor = useCallback((id: string, color: string) => { setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, color } : n))); }, []);
  const changeText = useCallback((id: string, text: string) => { setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, text } : n))); }, []);

  const addNodeAt = useCallback((type: NodeType, worldPos: { x: number; y: number }) => {
    const base = NODE_DEFAULTS[type];
    const color = type === 'sticky' ? FILL_COLORS[Math.floor(Math.random() * FILL_COLORS.length)] : type === 'shape' ? SHAPE_COLORS[0] : TEXT_COLORS[0];
    const node: CanvasNode = { id: genId(type[0]), type, x: worldPos.x - base.w / 2, y: worldPos.y - base.h / 2, w: base.w, h: base.h, text: '', color, rot: type === 'sticky' ? Math.random() * 6 - 3 : 0 };
    setNodes((ns) => [...ns, node]); setSelectedIds(new Set([node.id])); setEditingId(node.id); setSelectedEdgeId(null);
  }, []);

  const addNodeCenter = useCallback((type: NodeType) => {
    const rect = viewportRef.current!.getBoundingClientRect(), cam = cameraRef.current;
    const wc = { x: (rect.width / 2 - cam.x) / cam.scale, y: (rect.height / 2 - cam.y) / cam.scale };
    addNodeAt(type, { x: wc.x + (Math.random() - 0.5) * 30, y: wc.y + (Math.random() - 0.5) * 30 });
  }, [addNodeAt]);

  const zoomBy = useCallback((factor: number) => {
    const rect = viewportRef.current!.getBoundingClientRect(); setZoomAnimating(true);
    setCamera((cam) => { const cx = rect.width / 2, cy = rect.height / 2, ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * factor)), wx = (cx - cam.x) / cam.scale, wy = (cy - cam.y) / cam.scale; return { scale: ns, x: cx - wx * ns, y: cy - wy * ns }; });
    window.setTimeout(() => setZoomAnimating(false), 240);
  }, []);

  const fitView = useCallback(() => {
    const ns = nodesRef.current, rect = viewportRef.current!.getBoundingClientRect(); setZoomAnimating(true);
    if (!ns.length) { setCamera({ x: rect.width / 2, y: rect.height / 2, scale: 1 }); } else {
      const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y)), maxX = Math.max(...ns.map((n) => n.x + n.w)), maxY = Math.max(...ns.map((n) => n.y + n.h));
      const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1), pad = 100;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh)));
      setCamera({ scale, x: rect.width / 2 - (minX + bw / 2) * scale, y: rect.height / 2 - (minY + bh / 2) * scale });
    }
    window.setTimeout(() => setZoomAnimating(false), 240);
  }, []);

  /* wheel */
  useEffect(() => {
    const el = viewportRef.current; if (!el) return;
    const handler = (e: WheelEvent) => { e.preventDefault(); const rect = el.getBoundingClientRect(); if (e.ctrlKey || e.metaKey) { setCamera((cam) => { const f = Math.exp(-e.deltaY * 0.0022), ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * f)), cx = e.clientX - rect.left, cy = e.clientY - rect.top, wx = (cx - cam.x) / cam.scale, wy = (cy - cam.y) / cam.scale; return { scale: ns, x: cx - wx * ns, y: cy - wy * ns }; }); } else { setCamera((cam) => ({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY })); } };
    el.addEventListener('wheel', handler, { passive: false }); return () => el.removeEventListener('wheel', handler);
  }, []);

  /* pointer */
  const onMouseDownNode = useCallback((e: React.MouseEvent, node: CanvasNode) => {
    if (editingId === node.id) return;
    e.stopPropagation();
    const rect = viewportRef.current!.getBoundingClientRect(), world = screenToWorld(e.clientX, e.clientY, cameraRef.current, rect);
    if (e.shiftKey) {
      setSelectedIds((prev) => { const next = new Set(prev); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; });
    } else {
      if (!selectedIds.has(node.id)) setSelectedIds(new Set([node.id]));
      interactionRef.current = { type: 'drag-node', id: node.id, offset: { x: world.x - node.x, y: world.y - node.y } };
    }
    setSelectedEdgeId(null);
  }, [editingId, selectedIds]);

  const onDoubleClickNode = useCallback((e: React.MouseEvent, node: CanvasNode) => { e.stopPropagation(); setSelectedIds(new Set([node.id])); setEditingId(node.id); }, []);
  const onMouseDownAnchor = useCallback((e: React.MouseEvent, node: CanvasNode) => { e.stopPropagation(); interactionRef.current = { type: 'connect', fromId: node.id }; setPreviewLine({ fromId: node.id, x: node.x + node.w / 2, y: node.y + node.h / 2 }); }, []);
  const onMouseDownResize = useCallback((e: React.MouseEvent, node: CanvasNode) => { e.stopPropagation(); const rect = viewportRef.current!.getBoundingClientRect(), world = screenToWorld(e.clientX, e.clientY, cameraRef.current, rect); interactionRef.current = { type: 'resize', id: node.id, startW: node.w, startH: node.h, startWorld: world }; }, []);

  const onBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.shiftKey) {
      const rect = viewportRef.current!.getBoundingClientRect(), world = screenToWorld(e.clientX, e.clientY, cameraRef.current, rect);
      setSelectionBox({ sx: world.x, sy: world.y, ex: world.x, ey: world.y });
      interactionRef.current = { type: 'select-box' };
    } else {
      interactionRef.current = { type: 'pan', startClient: { x: e.clientX, y: e.clientY }, camStart: { ...cameraRef.current } };
      setSelectedIds(new Set()); setSelectedEdgeId(null);
    }
  }, []);

  const onBackgroundDoubleClick = useCallback((e: React.MouseEvent) => { if (e.target !== e.currentTarget) { const rect = viewportRef.current!.getBoundingClientRect(), world = screenToWorld(e.clientX, e.clientY, cameraRef.current, rect); addNodeAt('text', world); } }, [addNodeAt]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const mode = interactionRef.current.type; if (mode === 'none') return;
      const rect = viewportRef.current!.getBoundingClientRect();
      if (mode === 'pan') { const { startClient, camStart } = interactionRef.current; setCamera({ ...camStart, x: camStart.x + e.clientX - startClient.x, y: camStart.y + e.clientY - startClient.y }); return; }
      const world = screenToWorld(e.clientX, e.clientY, cameraRef.current, rect);
      if (mode === 'drag-node') {
        const { id, offset } = interactionRef.current;
        setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, x: world.x - offset.x, y: world.y - offset.y } : n)));
      } else if (mode === 'resize') {
        const { id, startW, startH, startWorld } = interactionRef.current;
        setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, w: Math.max(90, startW + world.x - startWorld.x), h: Math.max(48, startH + world.y - startWorld.y) } : n)));
      } else if (mode === 'connect') {
        setPreviewLine((p) => (p ? { ...p, x: world.x, y: world.y } : p));
      } else if (mode === 'select-box') {
        setSelectionBox((prev) => (prev ? { ...prev, ex: world.x, ey: world.y } : null));
      }
    };
    const onUp = (e: MouseEvent) => {
      const mode = interactionRef.current.type;
      if (mode === 'connect') {
        const rect = viewportRef.current!.getBoundingClientRect(), world = screenToWorld(e.clientX, e.clientY, cameraRef.current, rect), { fromId } = interactionRef.current;
        const target = nodesRef.current.find((n) => n.id !== fromId && world.x >= n.x && world.x <= n.x + n.w && world.y >= n.y && world.y <= n.y + n.h);
        if (target) setEdges((es) => { if (es.some((ed) => (ed.from === fromId && ed.to === target.id) || (ed.from === target.id && ed.to === fromId))) return es; return [...es, { id: genId('e'), from: fromId, to: target.id, arrowType: 'arrow' }]; });
        setPreviewLine(null);
      } else if (mode === 'select-box') {
        setSelectionBox((prev) => {
          if (!prev) return null;
          const minX = Math.min(prev.sx, prev.ex), minY = Math.min(prev.sy, prev.ey), maxX = Math.max(prev.sx, prev.ex), maxY = Math.max(prev.sy, prev.ey);
          if (maxX - minX > 3 || maxY - minY > 3) {
            const sel = new Set<string>();
            for (const n of nodesRef.current) { if (n.x < maxX && n.x + n.w > minX && n.y < maxY && n.y + n.h > minY) sel.add(n.id); }
            setSelectedIds(sel);
          }
          return null;
        });
      }
      interactionRef.current = { type: 'none' };
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId) { if (e.key === 'Escape') setEditingId(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedIds.size) { e.preventDefault(); deleteNodes(Array.from(selectedIds)); } else if (selectedEdgeId) { e.preventDefault(); deleteEdge(selectedEdgeId); } }
      else if (e.key === 'Escape') { setSelectedIds(new Set()); setSelectedEdgeId(null); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); setSelectedIds(new Set(nodesRef.current.map((n) => n.id))); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelected(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [editingId, selectedIds, selectedEdgeId, deleteNodes, deleteEdge, duplicateSelected]);

  const selectedNode = useMemo(() => { const ids = Array.from(selectedIds); return ids.length === 1 ? nodes.find((n) => n.id === ids[0]) || null : null; }, [nodes, selectedIds]);
  const nodeById = useCallback((id: string) => nodes.find((n) => n.id === id), [nodes]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', userSelect: 'none', fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes popIn { 0% { opacity: 0; transform: scale(0.92); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes dashFlow { to { stroke-dashoffset: -22px; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glowPulse { 0%,100% { box-shadow: 0 0 0 0 ${ACCENT_GLOW}; } 50% { box-shadow: 0 0 0 6px transparent; } }
        .cv-node { animation: popIn 0.25s cubic-bezier(0.22,1,0.36,1) both; }
        .preview-line { stroke-dasharray: 6 5; animation: dashFlow 0.6s linear infinite; }
        .cv-tb-btn { transition: background-color 0.15s ease, transform 0.1s ease; }
        .cv-tb-btn:hover { background-color: rgba(245,245,247,0.08); }
        .cv-tb-btn:active { transform: scale(0.94); }
        .cv-swatch { transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .cv-swatch:hover { transform: scale(1.2); box-shadow: 0 0 8px rgba(245,245,247,0.15); }
        .cv-anchor { transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .cv-anchor:hover { transform: scale(1.3); box-shadow: 0 0 8px ${ACCENT_GLOW}; }
        .cv-resize { transition: transform 0.12s ease; }
        .cv-resize:hover { transform: scale(1.3); }
        .cv-node-toolbar { animation: fadeIn 0.15s ease; }
        textarea::placeholder { color: ${MUTED}; font-style: italic; }
        .cv-vignette { position: absolute; inset: 0; pointer-events: none; z-index: 1; background: radial-gradient(ellipse at center, transparent 50%, rgba(10,10,12,0.5) 100%); }
      `}</style>

      <div ref={viewportRef} onMouseDown={onBackgroundMouseDown} onDoubleClick={onBackgroundDoubleClick}
        style={{ position: 'absolute', inset: 0, cursor: 'grab', backgroundColor: CANVAS_BG, backgroundImage: `radial-gradient(circle, ${DOT_COLOR} 1px, transparent 1px)`, backgroundSize: `${24 * camera.scale}px ${24 * camera.scale}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}>
        <div onMouseDown={onBackgroundMouseDown}
          style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`, transformOrigin: '0 0', transition: zoomAnimating ? 'transform 0.22s cubic-bezier(0.22,1,0.36,1)' : 'none', width: 1, height: 1 }}>
          <svg style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
            <defs>
              {/* Arrow markers - muted */}
              <marker id="arr-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill={MUTED} /></marker>
              <marker id="arr-circle-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><circle cx="5" cy="5" r="3" fill={MUTED} /></marker>
              <marker id="arr-diamond-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2,5 L5,1 L8,5 L5,9 Z" fill={MUTED} /></marker>
              {/* Arrow markers - accent (selected) */}
              <marker id="arr-arrow-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill={ACCENT} /></marker>
              <marker id="arr-circle-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><circle cx="5" cy="5" r="3" fill={ACCENT} /></marker>
              <marker id="arr-diamond-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2,5 L5,1 L8,5 L5,9 Z" fill={ACCENT} /></marker>
              <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            {edges.map((edge) => {
              const a = nodeById(edge.from), b = nodeById(edge.to); if (!a || !b) return null;
              const route = routeEdge(a, b), d = pathFromRoute(route), isSel = selectedEdgeId === edge.id, isHov = hoveredEdgeId === edge.id, mid = midpointOfRoute(route);
              const arrowType = edge.arrowType || 'arrow';
              const markerEnd = arrowType === 'none' ? undefined : (isSel ? `url(#arr-${arrowType}-accent)` : `url(#arr-${arrowType}-muted)`);
              return (<g key={edge.id}>
                <path d={d} stroke="transparent" strokeWidth={18} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onMouseEnter={() => setHoveredEdgeId(edge.id)} onMouseLeave={() => setHoveredEdgeId((h) => (h === edge.id ? null : h))} onMouseDown={(e) => { e.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedIds(new Set()); }} />
                <path d={d} fill="none" style={{ stroke: isSel ? ACCENT : isHov ? '#777' : MUTED, strokeWidth: isSel ? 2.5 : isHov ? 2 : 1.5, transition: 'stroke 0.15s ease, stroke-width 0.15s ease', filter: isSel ? 'url(#glow)' : 'none' }} markerEnd={markerEnd} />
                {(isSel || isHov) && (<g style={{ cursor: 'pointer', pointerEvents: 'auto' }} onMouseDown={(e) => { e.stopPropagation(); deleteEdge(edge.id); }}>
                  <circle cx={mid.x} cy={mid.y} r={9} fill={SURFACE_ELEVATED} stroke={isSel ? ACCENT : '#555'} strokeWidth={1.5} />
                  <line x1={mid.x - 3} y1={mid.y - 3} x2={mid.x + 3} y2={mid.y + 3} stroke={isSel ? ACCENT : '#888'} strokeWidth={1.5} strokeLinecap="round" />
                  <line x1={mid.x + 3} y1={mid.y - 3} x2={mid.x - 3} y2={mid.y + 3} stroke={isSel ? ACCENT : '#888'} strokeWidth={1.5} strokeLinecap="round" />
                </g>)}
              </g>);
            })}
            {previewLine && (() => { const a = nodeById(previewLine.fromId); if (!a) return null; const route = routeEdge(a, { x: previewLine.x, y: previewLine.y, w: 0, h: 0 }); return <path className="preview-line" d={pathFromRoute(route)} fill="none" stroke={ACCENT} strokeWidth={2} filter="url(#glow)" />; })()}
          </svg>
          {nodes.map((node) => (<NodeView key={node.id} node={node} isSelected={selectedIds.has(node.id)} isEditing={editingId === node.id} onMouseDownNode={onMouseDownNode} onDoubleClickNode={onDoubleClickNode} onMouseDownAnchor={onMouseDownAnchor} onMouseDownResize={onMouseDownResize} onChangeText={changeText} onCommitEdit={() => setEditingId(null)} />))}
        </div>
      </div>

      <div className="cv-vignette" />

      {/* Selection box */}
      {selectionBox && (<div style={{ position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none' }}><svg style={{ width: '100%', height: '100%', overflow: 'visible' }}><rect x={Math.min(selectionBox.sx * camera.scale + camera.x, selectionBox.ex * camera.scale + camera.x)} y={Math.min(selectionBox.sy * camera.scale + camera.y, selectionBox.ey * camera.scale + camera.y)} width={Math.abs(selectionBox.ex - selectionBox.sx) * camera.scale} height={Math.abs(selectionBox.ey - selectionBox.sy) * camera.scale} fill="rgba(245,245,247,0.08)" stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" rx={3} /></svg></div>)}

      {/* Empty state */}
      {loaded && nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: SURFACE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg></div>
          <p style={{ color: MUTED, fontSize: 14, fontWeight: 500, maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>Дважды кликните по холсту чтобы добавить текст</p>
        </div>
      )}

      {/* Logo */}
      <div style={{ position: 'absolute', top: 20, left: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#EDEDF2', letterSpacing: 0.3 }}>Canvas</span>
      </div>

      {/* Toolbar */}
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 2, background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: 4, backdropFilter: 'blur(12px)' }}>
        <ToolbarBtn title="Текст (T)" onClick={() => addNodeCenter('text')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg></ToolbarBtn>
        <ToolbarBtn title="Стикер" onClick={() => addNodeCenter('sticky')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M14 3v6h6"/></svg></ToolbarBtn>
        <ToolbarBtn title="Фигура" onClick={() => addNodeCenter('shape')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></ToolbarBtn>
        <Divider />
        <ToolbarBtn title="Вписать в экран" onClick={fitView}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0 2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></ToolbarBtn>
        <Divider />
        <ToolbarBtn title="Очистить" onClick={() => { if (nodes.length) { setNodes([]); setEdges([]); setSelectedIds(new Set()); setSelectedEdgeId(null); } }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></ToolbarBtn>
      </div>

      {/* Zoom */}
      <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', alignItems: 'center', gap: 2, background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: 4, backdropFilter: 'blur(12px)' }}>
        <ToolbarBtn title="Уменьшить" onClick={() => zoomBy(1 / 1.2)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></ToolbarBtn>
        <button onClick={() => { setZoomAnimating(true); setCamera((c) => ({ ...c, scale: 1 })); window.setTimeout(() => setZoomAnimating(false), 240); }} style={{ minWidth: 46, textAlign: 'center', fontSize: 13, fontWeight: 600, color: INK, background: 'transparent', border: 'none', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }} title="Сбросить масштаб">{Math.round(camera.scale * 100)}%</button>
        <ToolbarBtn title="Увеличить" onClick={() => zoomBy(1.2)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></ToolbarBtn>
      </div>

      {/* History button */}
      <div onClick={() => setShowHistory(!showHistory)} style={{ position: 'absolute', top: 20, right: 24, width: 36, height: 36, borderRadius: 8, background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 20 }} title="История канвасов">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
      </div>

      {/* History panel */}
      {showHistory && (
        <div style={{ position: 'absolute', top: 64, right: 24, width: 280, maxHeight: 400, background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.6)', zIndex: 30, overflow: 'hidden', animation: 'fadeIn 0.15s ease' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>История</span>
            <button onClick={newCanvas} style={{ fontSize: 12, fontWeight: 500, color: ACCENT, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>+ Новый</button>
          </div>
          {(currentCanvasId || (!currentCanvasId && nodes.length > 0)) && (
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={currentCanvasName} onChange={(e) => setCurrentCanvasName(e.target.value)} placeholder="Название..." style={{ flex: 1, fontSize: 13, fontWeight: 500, color: INK, background: 'transparent', border: 'none', outline: 'none', padding: '4px 0' }} />
              <button onClick={saveCurrentCanvas} style={{ fontSize: 12, fontWeight: 600, color: SURFACE, background: ACCENT, border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Сохранить</button>
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {savedCanvases.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 13 }}>Нет сохранённых канвасов</div>}
            {savedCanvases.map((c) => (
              <div key={c.id} style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: currentCanvasId === c.id ? 'rgba(245,245,247,0.08)' : 'transparent', borderBottom: `1px solid ${BORDER}`, transition: 'background 0.12s ease' }} onClick={() => loadCanvas(c.id)} onMouseEnter={(e) => { if (currentCanvasId !== c.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }} onMouseLeave={(e) => { if (currentCanvasId !== c.id) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8M8 12h6M8 16h4"/></svg></div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{c.nodes.length} элементов · {new Date(c.createdAt).toLocaleDateString('ru-RU')}</div></div>
                <button onClick={(e) => { e.stopPropagation(); deleteCanvas(c.id); }} style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, transition: 'opacity 0.12s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.4'} title="Удалить"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Node toolbar */}
      {selectedNode && editingId !== selectedNode.id && (
        <NodeToolbar node={selectedNode} camera={camera} onPickColor={(c) => setNodeColor(selectedNode.id, c)} onDuplicate={() => duplicateNode(selectedNode.id)} onDelete={() => deleteNode(selectedNode.id)} />
      )}

      {/* Edge toolbar */}
      {selectedEdgeId && (() => {
        const edge = edges.find((e) => e.id === selectedEdgeId);
        if (!edge) return null;
        const a = nodeById(edge.from), b = nodeById(edge.to);
        if (!a || !b) return null;
        const mid = midpointOfRoute(routeEdge(a, b));
        const sp = worldToScreen(mid, camera);
        const currentArrow = edge.arrowType || 'arrow';
        return (
          <div style={{ position: 'absolute', left: sp.x, top: sp.y - 40, transform: 'translate(-50%, -100%)', display: 'flex', alignItems: 'center', gap: 4, background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', padding: '6px 8px', zIndex: 20, animation: 'fadeIn 0.15s ease' }}>
            {ARROW_TYPES.map((at) => (
              <button key={at.type} title={at.label} onClick={() => setEdgeArrowType(selectedEdgeId, at.type)}
                style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: currentArrow === at.type ? 'rgba(245,245,247,0.15)' : 'transparent', color: currentArrow === at.type ? ACCENT : INK, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.12s ease' }}
                onMouseEnter={(e) => { if (currentArrow !== at.type) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { if (currentArrow !== at.type) e.currentTarget.style.background = 'transparent'; }}>
                {at.icon}
              </button>
            ))}
            <div style={{ width: 1, height: 20, background: BORDER, margin: '0 2px' }} />
            <button title="Удалить соединение" onClick={() => deleteEdge(selectedEdgeId)}
              style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        );
      })()}

      {/* Selection count */}
      {selectedIds.size > 1 && (
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: SURFACE_ELEVATED, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 500, color: INK, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Выбрано: {selectedIds.size}</span>
          <Divider />
          <button onClick={duplicateSelected} style={{ fontSize: 12, color: ACCENT, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Дублировать</button>
          <Divider />
          <button onClick={() => deleteNodes(Array.from(selectedIds))} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Удалить</button>
        </div>
      )}
    </div>
  );
}
