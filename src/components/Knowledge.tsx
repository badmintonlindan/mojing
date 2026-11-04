import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileText, Pencil, Trash2, Network, BookOpen, ChevronRight, Check, History, CalendarDays, X, RotateCcw, Tags, Image as ImageIcon } from 'lucide-react';
import type { Card, Review, Source, State } from '../core/model';
import { now, uid } from '../core/model';
import { createReview as createCoreReview, deleteCard as deleteCoreCard, scheduleReview } from '../core/operations';
import './knowledge.css';

export interface KnowledgeProps {
  state: State;
  setId: string;
  onChange: () => void;
  onSource: (source: Source) => void;
  onEdit: (card: Card) => void;
  notify: (message: string) => void;
  getAssetUrl?: (id: string) => Promise<string>;
}

export function CardImage({ assetId, getAssetUrl }: { assetId?: string; getAssetUrl?: KnowledgeProps['getAssetUrl'] }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl(''); setFailed(false);
    if (assetId && getAssetUrl) getAssetUrl(assetId).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [assetId, getAssetUrl]);
  if (!assetId) return null;
  return url ? <img className="knowledge-card-image" src={url} alt="原文区域摘录" draggable={false} /> : <div className="knowledge-image-placeholder"><ImageIcon size={18}/>{failed ? '摘录图片读取失败' : '载入摘录图片…'}</div>;
}

export function SourceButton({ card, state, onSource }: Pick<KnowledgeProps, 'state' | 'onSource'> & { card: Card }) {
  if (!card.source) return card.orphanedSource ? <span className="knowledge-missing-source">原文已移除 · {card.orphanedSource}</span> : null;
  const source = card.source;
  const doc = state.documents.find(item => item.id === source.documentId);
  return <button className="knowledge-source" onClick={() => onSource(source)} title="返回原文定位"><FileText size={13}/><span>{doc?.name || '来源文档'} · 第 {source.page} 页</span><ChevronRight size={13}/></button>;
}

export function createReview(state: State, card: Card, question = card.title): Review {
  return createCoreReview(state, card.id, question);
}

export function CardsPanel(props: KnowledgeProps) {
  const { state, setId, onChange, onEdit, onSource, notify, getAssetUrl } = props;
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [reviewCard, setReviewCard] = useState<Card | null>(null);
  const [question, setQuestion] = useState('');
  useEffect(() => { setSearch(''); setTag(''); setReviewCard(null); }, [setId]);
  const cards = state.cards.filter(card => card.setId === setId);
  const tags = [...new Set(cards.flatMap(card => card.tags))].sort();
  const filtered = cards.filter(card => (!tag || card.tags.includes(tag)) && [card.title, card.body, ...card.tags].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  function removeCard(card: Card) {
    if (!window.confirm(`删除“${card.title || '未命名卡片'}”？这也会移除对应脑图节点、复习安排和记录。`)) return;
    deleteCoreCard(state, card.id);
    onChange(); notify('卡片已删除');
  }
  function addToMap(card: Card) {
    if (state.nodes.some(node => node.setId === setId && node.cardId === card.id)) { notify('这张卡片已在脑图中'); return; }
    state.nodes.push({ id: uid(), setId, cardId: card.id, parentId: null, order: state.nodes.filter(node => node.setId === setId && !node.parentId).length, collapsed: false });
    onChange(); notify('已加入脑图，可在脑图中调整层级');
  }
  function addReview(card: Card) {
    const existing = state.reviews.find(review => review.cardId === card.id);
    setReviewCard(card); setQuestion(existing?.question || card.title || '请回忆这张卡片的内容');
  }
  return <section className="knowledge-panel" aria-label="知识卡片">
    <header className="knowledge-panel-header"><div><span className="knowledge-eyebrow">KNOWLEDGE CARDS</span><h2>知识卡片 <small>{cards.length}</small></h2></div><button className="knowledge-primary" onClick={() => { const stamp = now(); onEdit({ id: uid(), setId, title: '', body: '', color: '#e7bf61', tags: [], createdAt: stamp, updatedAt: stamp }); }}><Plus size={17}/>新建卡片</button></header>
    <div className="knowledge-filterbar"><label className="knowledge-search"><Search size={16}/><input aria-label="搜索卡片" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题、正文、标签"/>{search && <button aria-label="清除卡片搜索" onClick={() => setSearch('')}><X size={15}/></button>}</label>{tags.length > 0 && <label className="knowledge-tag-filter"><Tags size={15}/><select aria-label="按标签筛选" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(item => <option key={item}>{item}</option>)}</select></label>}</div>
    <div className="knowledge-card-list">
      {filtered.map(card => <article className="knowledge-card" key={card.id} style={{ '--card-color': card.color } as React.CSSProperties}>
        <div className="knowledge-card-heading"><h3><button onClick={() => onEdit(card)}>{card.title || '未命名卡片'}</button></h3><button className="knowledge-icon" aria-label={`编辑卡片 ${card.title}`} title="编辑卡片" onClick={() => onEdit(card)}><Pencil size={16}/></button></div>
        {card.body && <p className="knowledge-card-body">{card.body}</p>}
        <CardImage assetId={card.imageAssetId} getAssetUrl={getAssetUrl}/>
        {card.tags.length > 0 && <div className="knowledge-tags">{card.tags.map(item => <button key={item} onClick={() => setTag(item)}>#{item}</button>)}</div>}
        <SourceButton card={card} state={state} onSource={onSource}/>
        <footer className="knowledge-card-actions"><button onClick={() => addToMap(card)} title="将卡片加入脑图"><Network size={15}/>{state.nodes.some(node => node.cardId === card.id && node.setId === setId) ? '已在脑图' : '加入脑图'}</button><button onClick={() => addReview(card)}><BookOpen size={15}/>{state.reviews.some(review => review.cardId === card.id) ? '复习问题' : '加入复习'}</button><button className="knowledge-delete" aria-label={`删除卡片 ${card.title}`} title="删除卡片" onClick={() => removeCard(card)}><Trash2 size={15}/></button></footer>
      </article>)}
      {!filtered.length && <div className="knowledge-empty"><BookOpen size={35} strokeWidth={1.3}/><h3>{cards.length ? '没有匹配的卡片' : '把阅读变成自己的知识'}</h3><p>{cards.length ? '试试其他关键词或标签。' : '选择原文文字或截取区域创建卡片，也可以手动记录想法。'}</p></div>}
    </div>
    {reviewCard && <div className="knowledge-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReviewCard(null); }}><form className="knowledge-modal" role="dialog" aria-modal="true" aria-label="设置复习问题" onSubmit={event => { event.preventDefault(); const existing = state.reviews.find(review => review.cardId === reviewCard.id); if (existing) existing.question = question.trim() || reviewCard.title; else createReview(state, reviewCard, question); onChange(); setReviewCard(null); notify('复习问题已保存，答案使用卡片内容'); }}><header><h3>设置复习问题</h3><button type="button" className="knowledge-icon" aria-label="关闭复习问题" onClick={() => setReviewCard(null)}><X size={20}/></button></header><p>答案与卡片内容保持一致，编辑卡片会同步更新答案。</p><label>问题<textarea autoFocus rows={4} required value={question} onChange={event => setQuestion(event.target.value)} placeholder="用自己的话提出一个问题"/></label><footer><button type="button" className="knowledge-secondary" onClick={() => setReviewCard(null)}>取消</button><button className="knowledge-primary" type="submit"><Check size={16}/>保存问题</button></footer></form></div>}
  </section>;
}

const ratingNames = { again: '再学一次', hard: '有些困难', good: '已掌握', easy: '很轻松' } as const;
export function ReviewPanel(props: KnowledgeProps) {
  const { state, setId, onChange, onSource, onEdit, notify, getAssetUrl } = props;
  const [tab, setTab] = useState<'learn' | 'plan' | 'history'>('learn');
  const [showAnswer, setShowAnswer] = useState(false);
  const [practiceAll, setPracticeAll] = useState(false);
  const [practiced, setPracticed] = useState<string[]>([]);
  const [editing, setEditing] = useState<Review | null>(null);
  const [question, setQuestion] = useState('');
  useEffect(() => { setTab('learn'); setShowAnswer(false); setPracticeAll(false); setPracticed([]); setEditing(null); }, [setId]);
  const reviews = state.reviews.filter(review => review.setId === setId && state.cards.some(card => card.id === review.cardId));
  const dueReviews = reviews.filter(review => Date.parse(review.dueAt) <= Date.now());
  const queue = [...(practiceAll ? reviews : dueReviews)].filter(review => !practiced.includes(review.id)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const current = queue[0];
  const card = current ? state.cards.find(item => item.id === current.cardId)! : undefined;
  const logs = useMemo(() => state.reviewLogs.filter(log => log.setId === setId).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)), [state.reviewLogs, state.revision, setId, practiced.length]);
  useEffect(() => { setShowAnswer(false); }, [current?.id, setId]);
  function rate(rating: keyof typeof ratingNames) {
    if (!current || !card) return;
    scheduleReview(state, current.id, rating);
    setPracticed(items => [...items, current.id]);
    setShowAnswer(false);
    onChange();
    notify(`已记录“${ratingNames[rating]}”，下次复习时间已保存`);
  }
  return <section className="knowledge-panel review-panel" aria-label="卡片复习">
    <header className="knowledge-panel-header"><div><span className="knowledge-eyebrow">SPACED REPETITION</span><h2>温故知新 <small>{dueReviews.length} 张到期</small></h2></div><BookOpen size={25} className="knowledge-header-mark"/></header>
    <nav className="knowledge-tabs review-tabs" aria-label="复习页面"><button className={tab === 'learn' ? 'active' : ''} onClick={() => setTab('learn')}><BookOpen size={16}/>开始复习</button><button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}><CalendarDays size={16}/>复习安排 <small>{reviews.length}</small></button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={16}/>记录 <small>{logs.length}</small></button></nav>
    {tab === 'learn' && <div className="review-learn">
      {current && card ? <><div className="review-queue-label"><span>{practiceAll ? '自由练习' : '到期复习'} · 剩余 {queue.length} 张</span><span>本轮已完成 {practiced.length} 张</span></div><article className="review-flashcard" style={{ '--card-color': card.color } as React.CSSProperties}><span className="knowledge-eyebrow">QUESTION</span><h3>{current.question || card.title}</h3>{!showAnswer ? <div className="review-think"><p>先试着回忆，再展开答案。</p><button className="knowledge-primary review-answer-button" onClick={() => setShowAnswer(true)}>显示答案<ChevronRight size={18}/></button></div> : <div className="review-answer"><span className="knowledge-eyebrow">ANSWER</span><h4>{card.title}</h4><p>{card.body || (card.imageAssetId ? '' : '这张卡片还没有正文，可以编辑后补充。')}</p><CardImage assetId={card.imageAssetId} getAssetUrl={getAssetUrl}/><SourceButton card={card} state={state} onSource={onSource}/><button className="knowledge-text-button" onClick={() => onEdit(card)}><Pencil size={14}/>编辑答案卡片</button></div>}</article>{showAnswer && <div className="review-rating" aria-label="掌握程度反馈">{(Object.keys(ratingNames) as (keyof typeof ratingNames)[]).map(rating => <button key={rating} className={`review-rate-${rating}`} onClick={() => rate(rating)}><span>{ratingNames[rating]}</span><small>{rating === 'again' ? '10 分钟后' : rating === 'hard' ? `${Math.max(1, Math.round(current.interval * 1.2))} 天后` : rating === 'good' ? `${Math.max(1, Math.round(current.interval * 2.5))} 天后` : `${Math.max(4, Math.round(current.interval * 3.5))} 天后`}</small></button>)}</div>}</> : <div className="knowledge-empty review-complete"><Check size={40} strokeWidth={1.5}/><h3>{practiced.length ? '这一轮已完成' : reviews.length ? '暂时没有到期卡片' : '建立你的第一组复习卡片'}</h3><p>{practiced.length ? `已保存 ${practiced.length} 次复习记录，下次时间已安排。` : reviews.length ? '按自己的节奏复习，也可以提前练习所有卡片。' : '在知识卡片上选择“加入复习”，为卡片设置一个问题。'}</p>{reviews.length > 0 && <button className="knowledge-secondary" onClick={() => { setPracticeAll(true); setPracticed([]); setShowAnswer(false); }}><RotateCcw size={16}/>{practiced.length ? '再练习一轮' : '练习全部卡片'}</button>}</div>}
    </div>}
    {tab === 'plan' && <div className="review-plan"><div className="review-plan-toolbar"><span>问题来自卡片，答案随卡片同步更新。</span><button className="knowledge-secondary" disabled={!state.cards.some(card => card.setId === setId && !reviews.some(review => review.cardId === card.id))} onClick={() => { const pending = state.cards.filter(card => card.setId === setId && !reviews.some(review => review.cardId === card.id)); pending.forEach(card => createReview(state, card)); onChange(); notify(`已将 ${pending.length} 张卡片加入复习`); }}><Plus size={15}/>添加全部卡片</button></div>{[...reviews].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map(review => { const card = state.cards.find(card => card.id === review.cardId)!; return <article className="review-plan-row" key={review.id}><div><h3>{review.question}</h3><p>{card.title} · {new Date(review.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 连续掌握 {review.repetitions} 次</p></div><button className="knowledge-icon" aria-label={`编辑复习问题 ${review.question}`} title="编辑问题" onClick={() => { setEditing(review); setQuestion(review.question); }}><Pencil size={16}/></button><button className="knowledge-icon knowledge-delete" aria-label={`移除复习 ${review.question}`} title="移除复习安排" onClick={() => { if (window.confirm('移除这项复习安排及其历史记录？原卡片会保留。')) { state.reviews = state.reviews.filter(item => item.id !== review.id); state.reviewLogs = state.reviewLogs.filter(item => item.reviewId !== review.id); onChange(); notify('已移除复习安排'); } }}><Trash2 size={16}/></button></article>; })}{!reviews.length && <div className="knowledge-empty"><CalendarDays size={32}/><p>还没有复习安排。选择“添加全部卡片”或从卡片单独加入。</p></div>}</div>}
    {tab === 'history' && <div className="review-history">{logs.map(log => <article className="review-log" key={log.id}><span className={`review-log-rating ${log.rating}`}>{ratingNames[log.rating]}</span><div><h3>{state.cards.find(card => card.id === log.cardId)?.title || '卡片'}</h3><p>{new Date(log.reviewedAt).toLocaleString('zh-CN')}<br/>下次：{new Date(log.nextDueAt).toLocaleString('zh-CN')}</p></div></article>)}{!logs.length && <div className="knowledge-empty"><History size={32}/><p>完成一次复习后，记录会保存在这里。</p></div>}</div>}
    {editing && <div className="knowledge-modal-backdrop"><form className="knowledge-modal" role="dialog" aria-modal="true" aria-label="编辑复习问题" onSubmit={event => { event.preventDefault(); editing.question = question.trim(); onChange(); setEditing(null); notify('复习问题已更新'); }}><header><h3>编辑复习问题</h3><button type="button" className="knowledge-icon" aria-label="关闭" onClick={() => setEditing(null)}><X size={20}/></button></header><label>问题<textarea required autoFocus rows={4} value={question} onChange={event => setQuestion(event.target.value)}/></label><footer><button type="button" className="knowledge-secondary" onClick={() => setEditing(null)}>取消</button><button type="submit" className="knowledge-primary">保存</button></footer></form></div>}
  </section>;
}
