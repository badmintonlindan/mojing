import { now, uid, type ReviewLog, type State } from './model';
import { validateState } from './repository';

export function moveNode(state: State, nodeId: string, parentId: string | null, order?: number): void {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error('脑图节点不存在');
  if (parentId) {
    let parent = state.nodes.find(n => n.id === parentId);
    if (!parent || parent.setId !== node.setId) throw new Error('无法移动到其他学习集');
    const seen = new Set<string>();
    while (parent) {
      if (parent.id === nodeId || seen.has(parent.id)) throw new Error('不能将节点移到自身或其子孙节点下');
      seen.add(parent.id);
      parent = parent.parentId ? state.nodes.find(n => n.id === parent!.parentId) : undefined;
    }
  }
  node.parentId = parentId;
  node.order = order ?? Math.max(-1, ...state.nodes.filter(n => n.setId === node.setId && n.parentId === parentId && n.id !== nodeId).map(n => n.order)) + 1;
}

export function deleteCard(state: State, cardId: string): void {
  // Keep descendants in place by promoting them to the removed node's parent.
  const removedIds = new Set(state.nodes.filter(n => n.cardId === cardId).map(n => n.id));
  const byId = new Map(state.nodes.map(n => [n.id, n]));
  for (const node of state.nodes) {
    if (removedIds.has(node.id)) continue;
    const seen = new Set<string>();
    while (node.parentId && removedIds.has(node.parentId)) {
      if (seen.has(node.parentId)) throw new Error('脑图层级存在循环');
      seen.add(node.parentId);
      node.parentId = byId.get(node.parentId)?.parentId ?? null;
    }
  }
  state.nodes = state.nodes.filter(n => n.cardId !== cardId);
  state.cards = state.cards.filter(c => c.id !== cardId);
  state.reviews = state.reviews.filter(r => r.cardId !== cardId);
  state.reviewLogs = state.reviewLogs.filter(l => l.cardId !== cardId);
}

export function deleteDocument(state: State, docId: string): void {
  const doc = state.documents.find(d => d.id === docId);
  if (!doc) return;
  for (const set of state.sets) set.documentIds = set.documentIds.filter(id => id !== docId);
  for (const card of state.cards) if (card.source?.documentId === docId) {
    card.orphanedSource = `${doc.name} · 第 ${card.source.page} 页`;
    delete card.source;
  }
  state.documents = state.documents.filter(d => d.id !== docId);
  state.annotations = state.annotations.filter(a => a.documentId !== docId);
  if (state.activeDocumentId === docId) state.activeDocumentId = undefined;
}

export function deleteStudySet(state: State, setId: string): void {
  for (const card of state.cards.filter(c => c.setId === setId)) deleteCard(state, card.id);
  state.sets = state.sets.filter(s => s.id !== setId);
  state.annotations = state.annotations.filter(a => a.setId !== setId);
  state.nodes = state.nodes.filter(n => n.setId !== setId);
  if (state.activeSetId === setId) state.activeSetId = state.sets[0]?.id;
}

export function scheduleReview(state: State, reviewId: string, rating: ReviewLog['rating'], at = now()): ReviewLog {
  const review = state.reviews.find(r => r.id === reviewId);
  if (!review) throw new Error('复习计划不存在');
  const reviewedAt = new Date(at);
  if (!Number.isFinite(reviewedAt.getTime())) throw new Error('复习时间无效');
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('复习反馈无效');
  const day = 86400000;
  // Predictable interval schedule for the MVP; interval is measured in days.
  const interval = rating === 'again' ? 10 / 1440 : rating === 'hard' ? Math.max(1, review.interval * 1.2) : rating === 'good' ? Math.max(1, review.interval * 2.5) : Math.max(4, review.interval * 3.5);
  review.interval = Math.round(interval * 1e6) / 1e6;
  review.repetitions = rating === 'again' ? 0 : review.repetitions + 1;
  review.dueAt = new Date(reviewedAt.getTime() + interval * day).toISOString();
  const log: ReviewLog = { id: uid(), reviewId, cardId: review.cardId, setId: review.setId, rating, reviewedAt: reviewedAt.toISOString(), nextDueAt: review.dueAt };
  state.reviewLogs.push(log);
  return log;
}

export function createReview(state: State, cardId: string, question?: string) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) throw new Error('卡片不存在');
  const review = { id: uid(), cardId, setId: card.setId, question: question?.trim() || card.title || '这张卡片的主要内容是什么？', dueAt: now(), interval: 0, repetitions: 0 };
  state.reviews.push(review);
  return review;
}

export { validateState };
