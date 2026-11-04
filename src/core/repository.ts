import { SCHEMA_VERSION, emptyState, type Asset, type FileStore, type Rect, type State } from './model';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const utf8 = (text: string) => encoder.encode(text);
export const decodeUtf8 = (bytes: Uint8Array) => decoder.decode(bytes);
export async function sha256(bytes: Uint8Array): Promise<string> {
  // Copy to a concrete ArrayBuffer, also accepting Uint8Array<ArrayBufferLike>.
  const buffer = new Uint8Array(bytes).buffer;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`数据校验失败：${message}`);
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string';
const validDate = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const safeId = (id: unknown) => text(id) && id.length > 0 && id.length < 256;
const validRect = (rect: unknown): rect is Rect => Array.isArray(rect) && rect.length === 4 && rect.every(finite) && rect[0] <= rect[2] && rect[1] <= rect[3];

/** Validate relations before writing, and before an import is permitted to touch application state. */
export function validateState(state: State): void {
  assert(state && typeof state === 'object', '根对象无效');
  assert(state.schemaVersion === SCHEMA_VERSION, '不支持的数据库版本');
  assert(Number.isSafeInteger(state.revision) && state.revision >= 0, '修订号无效');
  for (const key of ['sets', 'documents', 'cards', 'annotations', 'nodes', 'reviews', 'reviewLogs', 'assets'] as const) {
    assert(Array.isArray(state[key]), `${key} 必须为数组`);
    const ids = new Set<string>();
    for (const item of state[key]) {
      assert(item && typeof item === 'object' && safeId(item.id), `${key} ID 无效`);
      assert(!ids.has(item.id), `${key} ID 重复：${item.id}`);
      ids.add(item.id);
    }
  }
  const assets = new Map(state.assets.map(a => [a.id, a]));
  const docs = new Map(state.documents.map(d => [d.id, d]));
  const sets = new Map(state.sets.map(s => [s.id, s]));
  const cards = new Map(state.cards.map(c => [c.id, c]));
  const nodes = new Map(state.nodes.map(n => [n.id, n]));
  const reviews = new Map(state.reviews.map(r => [r.id, r]));
  for (const asset of state.assets) {
    assert(/^[a-f0-9]{64}$/.test(asset.sha256) && asset.id === asset.sha256, '资源校验和无效');
    assert(new RegExp(`^assets/${asset.sha256}\\.(pdf|png|jpg|webp)$`).test(asset.path), '资源路径无效');
    assert(Number.isSafeInteger(asset.size) && asset.size > 0 && text(asset.mime), '资源大小或类型无效');
  }
  for (const doc of state.documents) {
    assert(text(doc.name) && doc.name.trim().length > 0 && validDate(doc.createdAt), '文档名称或日期无效');
    assert(assets.get(doc.assetId)?.mime === 'application/pdf', '文档资源缺失');
    assert(Number.isSafeInteger(doc.pageCount) && doc.pageCount >= 1, '文档页数无效');
    assert(doc.progress && Number.isSafeInteger(doc.progress.page) && doc.progress.page >= 1 && doc.progress.page <= doc.pageCount, '阅读页码无效');
    assert(finite(doc.progress.zoom) && doc.progress.zoom > 0 && [0, 90, 180, 270].includes(doc.progress.rotation), '阅读变换无效');
  }
  for (const set of state.sets) {
    assert(text(set.name) && set.name.trim().length > 0 && validDate(set.createdAt), '学习集名称或日期无效');
    assert(Array.isArray(set.documentIds) && new Set(set.documentIds).size === set.documentIds.length && set.documentIds.every(id => docs.has(id)), '学习集包含无效文档');
  }
  for (const card of state.cards) {
    const set = sets.get(card.setId);
    assert(set && text(card.title) && text(card.body) && text(card.color), '卡片内容或学习集无效');
    assert(Array.isArray(card.tags) && card.tags.every(text) && validDate(card.createdAt) && validDate(card.updatedAt), '卡片标签或日期无效');
    if (card.orphanedSource !== undefined) assert(text(card.orphanedSource), '卡片来源说明无效');
    if (card.imageAssetId) assert(assets.get(card.imageAssetId)?.mime.startsWith('image/'), '卡片图片缺失');
    if (card.source) {
      const doc = docs.get(card.source.documentId);
      assert(doc && set.documentIds.includes(doc.id), '卡片来源文档未关联学习集');
      assert(Number.isSafeInteger(card.source.page) && card.source.page >= 1 && card.source.page <= doc.pageCount, '卡片来源页码无效');
      assert(Array.isArray(card.source.rects) && card.source.rects.every(validRect), '卡片来源位置无效');
      if (card.source.quote !== undefined) assert(text(card.source.quote), '卡片来源摘录无效');
    }
  }
  for (const annotation of state.annotations) {
    const set = sets.get(annotation.setId), doc = docs.get(annotation.documentId);
    assert(set && doc && set.documentIds.includes(doc.id), '批注文档关系无效');
    assert(Number.isSafeInteger(annotation.page) && annotation.page >= 1 && annotation.page <= doc.pageCount && validDate(annotation.createdAt), '批注页码或日期无效');
    assert(text(annotation.color), '批注颜色无效');
    if (annotation.kind === 'highlight') {
      assert(Array.isArray(annotation.rects) && annotation.rects.length > 0 && annotation.rects.every(validRect), '高亮区域无效');
    } else {
      assert(annotation.kind === 'ink' && Array.isArray(annotation.points) && annotation.points.length > 0 && annotation.points.every(p => finite(p.x) && finite(p.y) && (p.pressure === undefined || (finite(p.pressure) && p.pressure >= 0 && p.pressure <= 1))), '手写路径无效');
      assert(finite(annotation.width) && annotation.width > 0, '手写线宽无效');
    }
  }
  for (const node of state.nodes) {
    assert(sets.has(node.setId) && cards.get(node.cardId)?.setId === node.setId, '脑图卡片关系无效');
    assert(finite(node.order) && typeof node.collapsed === 'boolean', '脑图节点状态无效');
    if (node.parentId !== null) assert(nodes.get(node.parentId)?.setId === node.setId, '脑图父节点无效');
  }
  const checkedNodes = new Set<string>();
  for (const node of state.nodes) {
    if (checkedNodes.has(node.id)) continue;
    const seen = new Set([node.id]);
    let cursor = node;
    while (cursor.parentId !== null && !checkedNodes.has(cursor.parentId)) {
      const parent = nodes.get(cursor.parentId);
      assert(parent && parent.setId === node.setId, '脑图父节点无效');
      assert(!seen.has(parent.id), '脑图层级存在循环');
      seen.add(parent.id);
      cursor = parent;
    }
    for (const id of seen) checkedNodes.add(id);
  }
  for (const review of state.reviews) {
    assert(cards.get(review.cardId)?.setId === review.setId && sets.has(review.setId), '复习卡片关系无效');
    assert(text(review.question) && validDate(review.dueAt) && finite(review.interval) && review.interval >= 0 && Number.isSafeInteger(review.repetitions) && review.repetitions >= 0, '复习计划无效');
  }
  for (const log of state.reviewLogs) {
    const review = reviews.get(log.reviewId);
    assert(review && review.cardId === log.cardId && review.setId === log.setId, '复习记录关系无效');
    assert(['again', 'hard', 'good', 'easy'].includes(log.rating) && validDate(log.reviewedAt) && validDate(log.nextDueAt), '复习记录无效');
  }
  if (state.activeSetId) assert(sets.has(state.activeSetId), '活动学习集无效');
  if (state.activeDocumentId) assert(docs.has(state.activeDocumentId), '活动文档无效');
}

/** Explicit migrations preserve old IDs and fail closed on a future version. */
export function migrateState(input: unknown): State {
  assert(input && typeof input === 'object', '数据库根对象无效');
  const state = structuredClone(input) as State;
  if (state.schemaVersion > SCHEMA_VERSION) throw new Error(`数据库版本 ${state.schemaVersion} 高于本应用支持的版本 ${SCHEMA_VERSION}，请升级应用；未覆盖数据。`);
  if (state.schemaVersion === 0) {
    state.schemaVersion = 1;
    state.revision ??= 0;
    state.reviewLogs ??= [];
    state.reviews ??= [];
    state.annotations ??= [];
    state.nodes ??= [];
    for (const doc of state.documents ?? []) doc.progress ??= { page: 1, zoom: 1, rotation: 0 };
  }
  validateState(state);
  return state;
}

interface Envelope { format: 'mojing.snapshot'; revision: number; sha256: string; state: State }

/** Two independent snapshots retain the last successful revision if a write is interrupted. */
export class Repository {
  state = emptyState();
  recoveryWarning: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  private committedSlot: string | null = null;
  private pendingAssets = new Map<string, Promise<Asset>>();
  constructor(public readonly store: FileStore) {}

  async load(): Promise<State> {
    await this.queue;
    const paths = ['snapshot-a.json', 'snapshot-b.json'];
    const entries = await Promise.all(paths.map(async path => {
      const bytes = await this.store.read(path);
      if (!bytes) return { present: false };
      try {
        const envelope = JSON.parse(decodeUtf8(bytes)) as Envelope;
        assert(envelope.format === 'mojing.snapshot' && envelope.revision === envelope.state.revision, '快照封套无效');
        assert(await sha256(utf8(JSON.stringify(envelope.state))) === envelope.sha256, '快照校验和不匹配');
        if (envelope.state.schemaVersion > SCHEMA_VERSION) return { present: true, future: envelope.state.schemaVersion };
        return { present: true, state: migrateState(envelope.state), path };
      } catch (error) {
        return { present: true, error };
      }
    }));
    const future = entries.find(e => e.future);
    if (future) throw new Error(`发现较新数据库版本 ${future.future}，请升级应用；未加载旧快照以防覆盖新数据。`);
    const candidates = entries.flatMap(e => e.state ? [{ state: e.state, path: e.path! }] : []).sort((a, b) => b.state.revision - a.state.revision);
    if (!candidates.length && entries.some(e => e.present)) throw new Error('两份本地快照均无法校验。已保留文件，请从完整学习集备份恢复。');
    this.state = candidates[0]?.state ?? emptyState();
    this.committedSlot = candidates[0]?.path ?? null;
    this.revision = this.state.revision;
    this.recoveryWarning = entries.some(e => e.error) ? '检测到未完成或损坏的快照，已恢复最近一份有效数据。' : null;
    return this.state;
  }

  save(): Promise<void> {
    validateState(this.state);
    const snapshot = structuredClone(this.state);
    snapshot.revision = this.revision = Math.max(this.revision, snapshot.revision) + 1;
    this.state.revision = snapshot.revision;
    const operation = this.queue.then(async () => {
      const envelope: Envelope = { format: 'mojing.snapshot', revision: snapshot.revision, sha256: await sha256(utf8(JSON.stringify(snapshot))), state: snapshot };
      // Alternate from the last *successful* commit. Revision parity would overwrite
      // the only good slot after a failed write followed by a retry.
      const path = this.committedSlot === 'snapshot-a.json' ? 'snapshot-b.json' : 'snapshot-a.json';
      const data = utf8(JSON.stringify(envelope));
      await this.store.write(path, data);
      const readBack = await this.store.read(path);
      if (!readBack || await sha256(readBack) !== await sha256(data)) throw new Error('自动保存后读回校验失败，请勿关闭应用并立即导出备份。');
      this.committedSlot = path;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async addAsset(bytes: Uint8Array, mime: string): Promise<Asset> {
    const extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    if (!extensions[mime] || bytes.byteLength === 0) throw new Error('不支持的资源类型或空文件');
    const hash = await sha256(bytes);
    const pending = this.pendingAssets.get(hash);
    if (pending) return pending;
    // Register before starting any asynchronous file work. Both the filesystem write
    // (including native .tmp files) and the metadata insertion must happen only once.
    const operation = Promise.resolve().then(async () => {
      const existing = this.state.assets.find(a => a.id === hash);
      if (existing) { await this.assetBytes(existing.id); return existing; }
      const asset: Asset = { id: hash, sha256: hash, mime, size: bytes.byteLength, path: `assets/${hash}.${extensions[mime]}` };
      await this.store.write(asset.path, bytes);
      this.state.assets.push(asset);
      return asset;
    });
    this.pendingAssets.set(hash, operation);
    try { return await operation; }
    finally { if (this.pendingAssets.get(hash) === operation) this.pendingAssets.delete(hash); }
  }

  async assetBytes(id: string): Promise<Uint8Array> {
    const asset = this.state.assets.find(a => a.id === id);
    if (!asset) throw new Error('资源索引不存在');
    const bytes = await this.store.read(asset.path);
    if (!bytes || bytes.byteLength !== asset.size || await sha256(bytes) !== asset.sha256) throw new Error(`资源缺失或校验失败：${asset.path}`);
    return bytes;
  }
}
