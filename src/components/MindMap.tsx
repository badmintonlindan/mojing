import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, Maximize2, Network, ChevronRight, ChevronDown, FileText, Pencil, Trash2, ArrowUp, ArrowDown, Move, X, CornerDownRight, ListTree, MousePointer2 } from 'lucide-react';
import type { Card, MindNode } from '../core/model';
import { uid } from '../core/model';
import { moveNode as moveCoreNode } from '../core/operations';
import type { KnowledgeProps } from './Knowledge';
import './knowledge.css';

const NODE_WIDTH = 224;
const NODE_HEIGHT = 98;
const X_GAP = 68;
const Y_GAP = 28;
interface PositionedNode { node: MindNode; card?: Card; x: number; y: number; children: MindNode[] }

export function MindMap(props: KnowledgeProps) {
  const { state, setId, onChange, onEdit, onSource, notify } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 24, y: 28 });
  const [picker, setPicker] = useState<{ parentId: string | null } | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveParent, setMoveParent] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: 'pan'; x: number; y: number; startPan: typeof pan; pointer: number } | { kind: 'node'; id: string; x: number; y: number; active: boolean; pointer: number } | null>(null);
  const nodes = state.nodes.filter(node => node.setId === setId);
  const cards = state.cards.filter(card => card.setId === setId);
  const selected = nodes.find(node => node.id === selectedId);
  const selectedCard = selected ? cards.find(card => card.id === selected.cardId) : undefined;
  useEffect(() => { setSelectedId(null); setZoom(0.85); setPan({ x: 24, y: 28 }); setPicker(null); setMoveOpen(false); cancelGesture(); }, [setId]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const next = Math.max(0.12, Math.min(2.5, zoom * Math.exp(-event.deltaY * 0.002)));
        const box = viewport.getBoundingClientRect();
        const cx = event.clientX - box.left; const cy = event.clientY - box.top;
        setPan(previous => ({ x: cx - (cx - previous.x) * next / zoom, y: cy - (cy - previous.y) * next / zoom }));
        setZoom(next);
      } else setPan(previous => ({ x: previous.x - event.deltaX, y: previous.y - event.deltaY }));
    };
    // Native listener is non-passive so Ctrl+wheel zooms this canvas rather than the app.
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [zoom]);
  const childrenOf = (parentId: string | null) => nodes.filter(node => node.parentId === parentId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const layout = useMemo(() => {
    const result: PositionedNode[] = [];
    const branchSizes = new Map<string, number>();
    const visited = new Set<string>();
    function branchHeight(node: MindNode, ancestors = new Set<string>()): number {
      if (ancestors.has(node.id)) return NODE_HEIGHT;
      const children = node.collapsed ? [] : nodes.filter(item => item.parentId === node.id).sort((a, b) => a.order - b.order);
      const next = new Set(ancestors).add(node.id);
      const height = Math.max(NODE_HEIGHT, children.reduce((sum, item) => sum + branchHeight(item, next), 0) + Math.max(0, children.length - 1) * Y_GAP);
      branchSizes.set(node.id, height);
      return height;
    }
    function position(node: MindNode, depth: number, top: number) {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const children = nodes.filter(item => item.parentId === node.id).sort((a, b) => a.order - b.order);
      result.push({ node, card: cards.find(card => card.id === node.cardId), x: 32 + depth * (NODE_WIDTH + X_GAP), y: top + ((branchSizes.get(node.id) || NODE_HEIGHT) - NODE_HEIGHT) / 2, children });
      if (!node.collapsed) { let cursor = top; for (const child of children) { position(child, depth + 1, cursor); cursor += (branchSizes.get(child.id) || NODE_HEIGHT) + Y_GAP; } }
    }
    let cursor = 32;
    const roots = nodes.filter(node => !node.parentId || !nodes.some(item => item.id === node.parentId)).sort((a, b) => a.order - b.order);
    for (const root of roots) { const height = branchHeight(root); position(root, 0, cursor); cursor += height + Y_GAP * 1.8; }
    return result;
  }, [state.nodes, state.cards, state.revision, setId, nodes.map(node => `${node.id}:${node.parentId}:${node.order}:${node.collapsed}`).join('|'), cards.map(card => `${card.id}:${card.title}:${card.body}:${card.color}`).join('|')]);
  const extent = { width: Math.max(600, ...layout.map(item => item.x + NODE_WIDTH + 40)), height: Math.max(400, ...layout.map(item => item.y + NODE_HEIGHT + 40)) };
  const descendantIds = (id: string) => { const ids = new Set([id]); let added = true; while (added) { added = false; for (const node of nodes) if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); added = true; } } return ids; };
  const moveExcluded = selected ? descendantIds(selected.id) : new Set<string>();
  function addNode(card: Card, parentId: string | null) {
    const id = uid();
    state.nodes.push({ id, setId, cardId: card.id, parentId, order: childrenOf(parentId).length, collapsed: false });
    if (parentId) { const parent = nodes.find(node => node.id === parentId); if (parent) parent.collapsed = false; }
    setSelectedId(id); setPicker(null); onChange(); notify('卡片已加入脑图');
  }
  function moveNode(nodeId: string, parentId: string | null) {
    const node = nodes.find(item => item.id === nodeId);
    if (!node || (parentId && descendantIds(nodeId).has(parentId))) { notify('不能移动到自己或自己的子节点下'); return; }
    moveCoreNode(state, nodeId, parentId);
    if (parentId) { const parent = nodes.find(item => item.id === parentId); if (parent) parent.collapsed = false; }
    onChange(); notify('脑图层级已更新');
  }
  function reorder(direction: -1 | 1) {
    if (!selected) return;
    const siblings = childrenOf(selected.parentId);
    const index = siblings.findIndex(node => node.id === selected.id);
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    siblings.forEach((node, order) => { node.order = order; }); onChange();
  }
  function removeSelected() {
    if (!selected) return;
    if (!window.confirm('从脑图移除此节点？卡片会保留，子节点将提升一级。')) return;
    const siblings = childrenOf(selected.parentId);
    for (const child of nodes.filter(node => node.parentId === selected.id)) { child.parentId = selected.parentId; child.order = siblings.length + child.order; }
    state.nodes = state.nodes.filter(node => node.id !== selected.id); setSelectedId(null); onChange(); notify('已移除脑图节点，卡片仍保留');
  }
  function fit() {
    const el = viewportRef.current;
    if (!el) return;
    const scale = Math.max(0.12, Math.min(1, (el.clientWidth - 48) / extent.width, (el.clientHeight - 48) / extent.height));
    setZoom(scale); setPan({ x: Math.max(16, (el.clientWidth - extent.width * scale) / 2), y: Math.max(16, (el.clientHeight - extent.height * scale) / 2) });
  }
  function changeZoom(value: number) {
    const el = viewportRef.current;
    const next = Math.max(0.12, Math.min(2.5, value));
    if (el) { const cx = el.clientWidth / 2; const cy = el.clientHeight / 2; setPan(previous => ({ x: cx - (cx - previous.x) * next / zoom, y: cy - (cy - previous.y) * next / zoom })); }
    setZoom(next);
  }
  function cancelGesture() { gesture.current = null; setDraggingId(null); setDropId(null); setIsPanning(false); }
  return <section className="knowledge-panel mind-panel" aria-label="思维导图">
    <header className="knowledge-panel-header"><div><span className="knowledge-eyebrow">CONNECTED THINKING</span><h2>知识脑图 <small>{nodes.length} 个节点</small></h2></div><button className="knowledge-primary" onClick={() => { setCardSearch(''); setPicker({ parentId: null }); }}><Plus size={17}/>根节点</button></header>
    <div className="mind-actionbar"><button disabled={!selected} title="添加子节点" onClick={() => { if (selected) { setCardSearch(''); setPicker({ parentId: selected.id }); } }}><CornerDownRight size={16}/>子节点</button><button disabled={!selected} title="添加同级节点" onClick={() => { if (selected) { setCardSearch(''); setPicker({ parentId: selected.parentId }); } }}><Plus size={16}/>同级</button><button disabled={!selected} title="移动节点到其他父节点" onClick={() => { setMoveParent(selected?.parentId || ''); setMoveOpen(true); }}><Move size={16}/>移动</button><button className="knowledge-icon" disabled={!selected} title="在同级中上移" aria-label="同级上移" onClick={() => reorder(-1)}><ArrowUp size={16}/></button><button className="knowledge-icon" disabled={!selected} title="在同级中下移" aria-label="同级下移" onClick={() => reorder(1)}><ArrowDown size={16}/></button><button className="knowledge-icon knowledge-delete" disabled={!selected} title="移除节点，保留卡片" aria-label="移除脑图节点" onClick={removeSelected}><Trash2 size={16}/></button><span className="mind-toolbar-spacer"/><button title="重新适配自动布局" onClick={fit}><ListTree size={16}/>自动布局</button></div>
    <div ref={viewportRef} className={`mind-viewport ${isPanning ? 'panning' : ''}`} onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('button,input,select')) return;
      const nodeEl = (event.target as Element).closest<HTMLElement>('[data-mind-node]');
      if (nodeEl) { const id = nodeEl.dataset.mindNode!; setSelectedId(id); gesture.current = { kind: 'node', id, x: event.clientX, y: event.clientY, active: false, pointer: event.pointerId }; }
      else { gesture.current = { kind: 'pan', x: event.clientX, y: event.clientY, startPan: pan, pointer: event.pointerId }; setIsPanning(true); }
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      const dx = event.clientX - current.x; const dy = event.clientY - current.y;
      if (current.kind === 'pan') setPan({ x: current.startPan.x + dx, y: current.startPan.y + dy });
      else if (Math.hypot(dx, dy) > 12 || current.active) {
        current.active = true; setDraggingId(current.id);
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-mind-node]')?.dataset.mindNode;
        setDropId(hit && hit !== current.id && !descendantIds(current.id).has(hit) ? hit : null);
      }
    }} onPointerUp={event => {
      const current = gesture.current;
      if (current?.kind === 'node' && current.active && dropId) moveNode(current.id, dropId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      cancelGesture();
    }} onPointerCancel={cancelGesture}>
      {!nodes.length ? <div className="knowledge-empty mind-empty"><Network size={48} strokeWidth={1.1}/><h3>让卡片之间产生联系</h3><p>从已有卡片添加根节点，再添加子节点和同级节点。<br/>脑图和卡片共用内容，修改会同步到每一处。</p><button className="knowledge-secondary" onClick={() => { setCardSearch(''); setPicker({ parentId: null }); }}><Plus size={17}/>添加第一张卡片</button></div> : <div className="mind-world" style={{ width: extent.width, height: extent.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="mind-connections" width={extent.width} height={extent.height} aria-hidden="true">{layout.map(item => { const parent = layout.find(node => node.node.id === item.node.parentId); if (!parent) return null; const x1 = parent.x + NODE_WIDTH; const y1 = parent.y + NODE_HEIGHT / 2; const x2 = item.x; const y2 = item.y + NODE_HEIGHT / 2; return <path key={item.node.id} d={`M ${x1} ${y1} C ${x1 + X_GAP / 2} ${y1}, ${x2 - X_GAP / 2} ${y2}, ${x2} ${y2}`} />; })}</svg>
        {layout.map(({ node, card, x, y, children }) => <div role="group" aria-label={`脑图节点 ${card?.title || '卡片'}`} tabIndex={0} data-mind-node={node.id} key={node.id} className={`mind-node ${selectedId === node.id ? 'selected' : ''} ${draggingId === node.id ? 'dragging' : ''} ${dropId === node.id ? 'drop-target' : ''}`} style={{ left: x, top: y, width: NODE_WIDTH, minHeight: NODE_HEIGHT, '--card-color': card?.color || '#e7bf61' } as React.CSSProperties} onClick={() => setSelectedId(node.id)} onDoubleClick={() => card && onEdit(card)} onKeyDown={event => { if (event.key === 'Enter') { setSelectedId(node.id); if (card) onEdit(card); } if (event.key === ' ') { event.preventDefault(); node.collapsed = !node.collapsed; onChange(); } }}>
          <h3>{card?.title || '未命名卡片'}</h3><p>{card?.body || (card?.imageAssetId ? '图片摘录' : '点击编辑卡片内容')}</p><footer>{card?.source && <button aria-label={`返回原文 ${card.title}`} title={`返回第 ${card.source.page} 页`} onClick={event => { event.stopPropagation(); if (card.source) onSource(card.source); }}><FileText size={14}/>p.{card.source.page}</button>}<span className="mind-node-spacer"/>{card && <button aria-label={`编辑脑图卡片 ${card.title}`} title="编辑共享卡片" onClick={event => { event.stopPropagation(); onEdit(card); }}><Pencil size={14}/></button>}{children.length > 0 && <button aria-label={`${node.collapsed ? '展开' : '折叠'}节点 ${card?.title || ''}`} title={node.collapsed ? '展开子节点' : '折叠子节点'} onClick={event => { event.stopPropagation(); node.collapsed = !node.collapsed; onChange(); }}>{node.collapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}<span>{children.length}</span></button>}</footer>
        </div>)}
      </div>}
      <div className="mind-zoom-controls"><button aria-label="缩小脑图" title="缩小" onClick={() => changeZoom(zoom / 1.2)}><Minus size={18}/></button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大脑图" title="放大" onClick={() => changeZoom(zoom * 1.2)}><Plus size={18}/></button><button aria-label="适应脑图画布" title="适应画布" onClick={fit}><Maximize2 size={17}/></button></div>
      {draggingId && <div className="mind-drag-hint">{dropId ? '松开后成为目标节点的子节点' : '拖到其他节点上更改父级'}</div>}
    </div>
    <footer className="mind-statusbar"><MousePointer2 size={13}/><span>{selectedCard ? `已选：${selectedCard.title || '未命名卡片'}` : '选择节点编辑层级'} · 拖空白处平移，Ctrl + 滚轮缩放</span>{selectedCard?.source && <button aria-label="返回选中节点原文" title="返回选中节点的原文" onClick={() => selectedCard.source && onSource(selectedCard.source)}><FileText size={16}/>原文</button>}{selectedCard && <button aria-label="编辑选中卡片" title="编辑选中卡片" onClick={() => onEdit(selectedCard)}><Pencil size={16}/></button>}</footer>
    {picker && <div className="knowledge-modal-backdrop"><div className="knowledge-modal mind-picker" role="dialog" aria-modal="true" aria-label="选择脑图卡片"><header><h3>{picker.parentId ? '添加子节点' : '添加根节点'}</h3><button className="knowledge-icon" aria-label="关闭卡片选择" onClick={() => setPicker(null)}><X size={20}/></button></header><p>节点引用同一张知识卡片，任何位置的编辑都会同步。</p><input className="mind-picker-search" autoFocus aria-label="搜索可加入脑图的卡片" placeholder="搜索卡片标题或内容" value={cardSearch} onChange={event => setCardSearch(event.target.value)}/><div className="mind-picker-list">{cards.filter(card => `${card.title} ${card.body}`.toLocaleLowerCase().includes(cardSearch.toLocaleLowerCase())).map(card => <button key={card.id} onClick={() => addNode(card, picker.parentId)}><span className="mind-color-dot" style={{ backgroundColor: card.color }}/><span><strong>{card.title || '未命名卡片'}</strong><small>{card.body.slice(0, 90) || '图片 / 空白卡片'}{nodes.some(node => node.cardId === card.id) ? ' · 已在脑图，可再次引用' : ''}</small></span><Plus size={16}/></button>)}{!cards.length && <div className="knowledge-empty"><BookOpenFallback/><p>请先从原文摘录或手动创建知识卡片。</p></div>}</div><footer><button className="knowledge-secondary" onClick={() => setPicker(null)}>关闭</button></footer></div></div>}
    {moveOpen && selected && <div className="knowledge-modal-backdrop"><form className="knowledge-modal" role="dialog" aria-modal="true" aria-label="移动脑图节点" onSubmit={event => { event.preventDefault(); moveNode(selected.id, moveParent || null); setMoveOpen(false); }}><header><h3>移动节点</h3><button type="button" className="knowledge-icon" aria-label="关闭节点移动" onClick={() => setMoveOpen(false)}><X size={20}/></button></header><p>选择新的父节点。当前节点及其子树会一起移动。</p><label>父节点<select value={moveParent} onChange={event => setMoveParent(event.target.value)}><option value="">无父节点（设为根节点）</option>{nodes.filter(node => !moveExcluded.has(node.id)).map(node => <option value={node.id} key={node.id}>{cards.find(card => card.id === node.cardId)?.title || '未命名卡片'}</option>)}</select></label><footer><button type="button" className="knowledge-secondary" onClick={() => setMoveOpen(false)}>取消</button><button type="submit" className="knowledge-primary">移动节点</button></footer></form></div>}
  </section>;
}
function BookOpenFallback() { return <Network size={28}/>; }
export default MindMap;
