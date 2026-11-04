import { unzipSync, zipSync } from 'fflate';
import { emptyState, now, uid, type State } from './model';
import { decodeUtf8, migrateState, Repository, sha256, utf8, validateState } from './repository';

export const EXCHANGE_VERSION = 1;
export const EXCHANGE_LIMITS = { archiveBytes: 256 * 1024 * 1024, expandedBytes: 512 * 1024 * 1024, entries: 5000, metadataBytes: 16 * 1024 * 1024 };
interface Entry { path: string; size: number; sha256: string }
interface Manifest { format: 'mojing.studyset'; version: number; schemaVersion: number; createdAt: string; studySetId: string; hashAlgorithm: 'SHA-256'; files: Entry[] }

function subset(state: State, setId: string): State {
  validateState(state);
  const studySet = state.sets.find(s => s.id === setId);
  if (!studySet) throw new Error('学习集不存在');
  const documents = state.documents.filter(d => studySet.documentIds.includes(d.id));
  const cards = state.cards.filter(c => c.setId === setId);
  const neededAssets = new Set([...documents.map(d => d.assetId), ...cards.flatMap(c => c.imageAssetId ? [c.imageAssetId] : [])]);
  const result: State = {
    ...emptyState(), sets: [studySet], documents, cards,
    annotations: state.annotations.filter(a => a.setId === setId),
    nodes: state.nodes.filter(n => n.setId === setId),
    reviews: state.reviews.filter(r => r.setId === setId),
    reviewLogs: state.reviewLogs.filter(r => r.setId === setId),
    assets: state.assets.filter(a => neededAssets.has(a.id)),
    activeSetId: setId, activeDocumentId: documents.find(d => d.id === state.activeDocumentId)?.id ?? documents[0]?.id,
  };
  validateState(result);
  return structuredClone(result);
}

export async function exportStudySet(repo: Repository, setId: string): Promise<Uint8Array> {
  const state = subset(repo.state, setId);
  const files: Record<string, Uint8Array> = { 'study.json': utf8(JSON.stringify(state)) };
  if (files['study.json'].byteLength > EXCHANGE_LIMITS.metadataBytes) throw new Error('学习集元数据超过 16 MiB 上限');
  if (state.assets.length + 2 > EXCHANGE_LIMITS.entries) throw new Error('学习集超过 5000 个交换包文件上限');
  for (const asset of state.assets) files[asset.path] = await repo.assetBytes(asset.id);
  const manifest: Manifest = {
    format: 'mojing.studyset', version: EXCHANGE_VERSION, schemaVersion: state.schemaVersion,
    createdAt: now(), studySetId: setId, hashAlgorithm: 'SHA-256',
    files: await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, size: data.byteLength, sha256: await sha256(data) }))),
  };
  const expandedBytes = Object.values(files).reduce((n, data) => n + data.byteLength, 0);
  if (expandedBytes > EXCHANGE_LIMITS.expandedBytes) throw new Error('学习集超过首版交换包 512 MiB 解压大小上限');
  files['manifest.json'] = utf8(JSON.stringify(manifest));
  const archive = zipSync(files, { level: 0 }); // PDFs/PNGs are already compressed; avoid blocking mobile CPU.
  if (archive.byteLength > EXCHANGE_LIMITS.archiveBytes) throw new Error('学习集超过首版交换包 256 MiB 上限');
  return archive;
}

/** Safe extraction validates the central-directory sizes before allocating uncompressed entries. */
export function unpackArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > EXCHANGE_LIMITS.archiveBytes) throw new Error('交换包超过 256 MiB 上限');
  let expandedBytes = 0;
  const seen = new Set<string>();
  try {
    return unzipSync(bytes, { filter: entry => {
      if (seen.has(entry.name)) throw new Error('交换包含重复路径');
      seen.add(entry.name);
      if (seen.size > EXCHANGE_LIMITS.entries) throw new Error('交换包文件数量超限');
      if (!/^(manifest\.json|study\.json|assets\/[a-f0-9]{64}\.(pdf|png|jpg|webp))$/.test(entry.name)) throw new Error('交换包存在不安全或未知路径');
      if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) throw new Error('交换包大小无效');
      if (entry.name.endsWith('.json') && entry.originalSize > EXCHANGE_LIMITS.metadataBytes) throw new Error('交换包元数据过大');
      expandedBytes += entry.originalSize;
      if (expandedBytes > EXCHANGE_LIMITS.expandedBytes) throw new Error('交换包解压大小超限');
      return true;
    } });
  } catch (error) {
    throw new Error(`无法读取交换包：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Always imports as a new study set. No existing learning data is silently replaced. */
export async function importStudySet(repo: Repository, bytes: Uint8Array): Promise<{ setId: string; documentCount: number; cardCount: number }> {
  const files = unpackArchive(bytes);
  if (!files['manifest.json'] || !files['study.json']) throw new Error('交换包缺少 manifest.json 或 study.json');
  const manifest = JSON.parse(decodeUtf8(files['manifest.json'])) as Manifest;
  if (manifest.format !== 'mojing.studyset' || manifest.version !== EXCHANGE_VERSION || manifest.hashAlgorithm !== 'SHA-256') throw new Error('不支持的交换包格式或版本，请使用兼容版本的应用');
  if (manifest.schemaVersion > 1) throw new Error('交换包来自较新数据库版本，请先升级应用');
  if (!Array.isArray(manifest.files) || manifest.files.length !== Object.keys(files).length - 1) throw new Error('交换包文件清单不完整');
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path) || entry.path === 'manifest.json') throw new Error('交换包文件清单无效');
    seen.add(entry.path);
    const data = files[entry.path];
    if (!data || data.byteLength !== entry.size || await sha256(data) !== entry.sha256) throw new Error(`交换包完整性校验失败：${entry.path}`);
  }
  const imported = migrateState(JSON.parse(decodeUtf8(files['study.json'])));
  if (imported.schemaVersion !== manifest.schemaVersion || imported.sets.length !== 1 || imported.sets[0].id !== manifest.studySetId) throw new Error('交换包学习集与清单不一致');
  for (const asset of imported.assets) {
    const entry = manifest.files.find(f => f.path === asset.path);
    if (!entry || entry.sha256 !== asset.sha256 || entry.size !== asset.size) throw new Error('资源索引与完整性清单不一致');
  }
  const expectedPaths = new Set(['study.json', ...imported.assets.map(a => a.path)]);
  if (seen.size !== expectedPaths.size || [...seen].some(path => !expectedPaths.has(path))) throw new Error('交换包包含未登记的资源');

  const idMap = new Map<string, string>();
  // IDs are unique per entity table; use separate maps to avoid an adversarial cross-table collision.
  const ids = <T extends { id: string }>(items: T[], type: string) => {
    for (const item of items) idMap.set(`${type}:${item.id}`, uid());
  };
  ids(imported.sets, 'set'); ids(imported.documents, 'doc'); ids(imported.cards, 'card');
  ids(imported.annotations, 'annotation'); ids(imported.nodes, 'node'); ids(imported.reviews, 'review'); ids(imported.reviewLogs, 'log');
  const id = (type: string, old: string) => {
    const result = idMap.get(`${type}:${old}`);
    if (!result) throw new Error('交换包含无法解析的关系');
    return result;
  };
  const copy = structuredClone(repo.state);
  const original = repo.state;
  const setId = id('set', imported.sets[0].id);
  const baseName = imported.sets[0].name;
  let name = `${baseName}（导入）`, suffix = 2;
  while (copy.sets.some(s => s.name === name)) name = `${baseName}（导入 ${suffix++}）`;
  copy.sets.push(...imported.sets.map(s => ({ ...s, id: setId, name, documentIds: s.documentIds.map(d => id('doc', d)) })));
  copy.documents.push(...imported.documents.map(d => ({ ...d, id: id('doc', d.id) })));
  copy.cards.push(...imported.cards.map(c => ({ ...c, id: id('card', c.id), setId, source: c.source ? { ...c.source, documentId: id('doc', c.source.documentId) } : undefined })));
  copy.annotations.push(...imported.annotations.map(a => ({ ...a, id: id('annotation', a.id), setId, documentId: id('doc', a.documentId) })));
  copy.nodes.push(...imported.nodes.map(n => ({ ...n, id: id('node', n.id), setId, cardId: id('card', n.cardId), parentId: n.parentId ? id('node', n.parentId) : null })));
  copy.reviews.push(...imported.reviews.map(r => ({ ...r, id: id('review', r.id), setId, cardId: id('card', r.cardId) })));
  copy.reviewLogs.push(...imported.reviewLogs.map(l => ({ ...l, id: id('log', l.id), setId, reviewId: id('review', l.reviewId), cardId: id('card', l.cardId) })));
  for (const asset of imported.assets) if (!copy.assets.some(a => a.id === asset.id)) copy.assets.push(asset);
  copy.activeSetId = setId;
  copy.activeDocumentId = imported.activeDocumentId ? id('doc', imported.activeDocumentId) : imported.documents[0] ? id('doc', imported.documents[0].id) : undefined;
  validateState(copy);

  // Write immutable, content-addressed assets first. Failed imports can only leave unused files.
  for (const asset of imported.assets) {
    const existing = original.assets.find(a => a.id === asset.id);
    if (existing) {
      try { await repo.assetBytes(asset.id); continue; } catch { /* Repair from the fully checked package. */ }
    }
    await repo.store.write(asset.path, files[asset.path]);
  }
  repo.state = copy;
  try { await repo.save(); } catch (error) { repo.state = original; throw error; }
  return { setId, documentCount: imported.documents.length, cardCount: imported.cards.length };
}

const escaped = (value: string) => value.replace(/[\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
export function exportMarkdown(state: State, setId: string): string {
  const selected = subset(state, setId);
  const lines = [`# ${selected.sets[0].name}`, '', `导出时间：${now()}`, ''];
  for (const card of selected.cards) {
    lines.push(`## ${card.title || '未命名卡片'}`, '', card.body, '');
    if (card.tags.length) lines.push(`标签：${card.tags.map(t => `#${t}`).join(' ')}`, '');
    if (card.imageAssetId) {
      const asset = selected.assets.find(a => a.id === card.imageAssetId)!;
      lines.push(`![${escaped(card.title || '截图摘录')}](${asset.path})`, '');
    }
    if (card.source) {
      const doc = selected.documents.find(d => d.id === card.source!.documentId)!;
      const asset = selected.assets.find(a => a.id === doc.assetId)!;
      lines.push(`> 来源：[${escaped(doc.name)} · 第 ${card.source.page} 页](${asset.path}#page=${card.source.page})`, `> PDF 区域：${JSON.stringify(card.source.rects)}`, '');
      if (card.source.quote) lines.push(`> 摘录：${card.source.quote.replace(/\r?\n/g, '\n> ')}`, '');
    } else if (card.orphanedSource) lines.push(`> 原始来源：${card.orphanedSource}（文档已移除）`, '');
    lines.push(`<!-- card-id: ${card.id} -->`, '');
  }
  return lines.join('\n');
}

/** Companion export keeps Markdown image/PDF links usable offline. */
export async function exportMarkdownBundle(repo: Repository, setId: string): Promise<Uint8Array> {
  const selected = subset(repo.state, setId);
  const files: Record<string, Uint8Array> = { '笔记.md': utf8(exportMarkdown(repo.state, setId)) };
  for (const asset of selected.assets) files[asset.path] = await repo.assetBytes(asset.id);
  return zipSync(files, { level: 0 });
}
