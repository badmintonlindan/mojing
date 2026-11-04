import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { emptyState, now, uid, type FileStore, type State } from '../src/core/model';
import { pdfRectToViewport, pdfToViewport, viewportRectToPdf, viewportToPdf, distanceToSegment } from '../src/core/geometry';
import { decodeUtf8, migrateState, Repository, sha256, utf8, validateState } from '../src/core/repository';
import { exportMarkdownBundle, exportStudySet, importStudySet, unpackArchive } from '../src/core/exchange';
import { createReview, deleteCard, deleteDocument, moveNode, scheduleReview } from '../src/core/operations';

class MemoryStore implements FileStore {
  files = new Map<string, Uint8Array>();
  writeCounts = new Map<string, number>();
  interruptNextWrite = false;
  async read(path: string) { return this.files.get(path)?.slice() ?? null; }
  async write(path: string, bytes: Uint8Array) {
    this.writeCounts.set(path, (this.writeCounts.get(path) ?? 0) + 1);
    if (this.interruptNextWrite) {
      this.interruptNextWrite = false;
      this.files.set(path, bytes.slice(0, 20));
      throw new Error('模拟写入中断');
    }
    this.files.set(path, bytes.slice());
  }
  async remove(path: string) { this.files.delete(path); }
}

class DelayedStore extends MemoryStore {
  activeWrites = 0;
  maximumActiveWrites = 0;
  async write(path: string, bytes: Uint8Array) {
    this.activeWrites++;
    this.maximumActiveWrites = Math.max(this.maximumActiveWrites, this.activeWrites);
    try { await new Promise(resolve => setTimeout(resolve, 25)); await super.write(path, bytes); }
    finally { this.activeWrites--; }
  }
}

async function fixture() {
  const store = new MemoryStore(), repo = new Repository(store);
  const date = '2026-11-04T02:00:00.000Z';
  repo.state.sets.push({ id: 'set-a', name: '中文学习集', documentIds: ['doc-a', 'doc-b'], createdAt: date });
  const pdf = await repo.addAsset(utf8('%PDF-1.7 text fixture'), 'application/pdf');
  const scan = await repo.addAsset(utf8('%PDF-1.7 scanned fixture'), 'application/pdf');
  const png = await repo.addAsset(new Uint8Array([137,80,78,71,13,10,26,10]), 'image/png');
  for (const [id, asset] of [['doc-a', pdf], ['doc-b', scan]] as const) repo.state.documents.push({ id, name: id === 'doc-a' ? '含文字层的中文资料.pdf' : '扫描资料.pdf', assetId: asset.id, pageCount: 3, createdAt: date, progress: { page: 2, zoom: 1.75, rotation: 90 } });
  for (let i = 0; i < 20; i++) {
    repo.state.cards.push({ id: `card-${i}`, setId: 'set-a', title: `知识卡片 ${i + 1}`, body: `正文与中文路径 /学习/资料 ${i}`, color: '#ffe4a0', tags: ['测试', i % 2 ? '扫描' : '文本'], source: { documentId: i % 2 ? 'doc-b' : 'doc-a', page: 2, rects: [[36, 125, 267, 150]], quote: i % 2 ? undefined : '选中的原文' }, imageAssetId: i % 2 ? png.id : undefined, createdAt: date, updatedAt: date });
    repo.state.nodes.push({ id: `node-${i}`, setId: 'set-a', cardId: `card-${i}`, parentId: i === 0 ? null : i === 1 ? 'node-0' : 'node-1', order: i, collapsed: false });
  }
  repo.state.annotations.push({ id: 'highlight', setId: 'set-a', documentId: 'doc-a', page: 2, kind: 'highlight', color: '#fff27a', rects: [[36,125,267,150]], createdAt: date });
  repo.state.annotations.push({ id: 'ink', setId: 'set-a', documentId: 'doc-b', page: 2, kind: 'ink', color: '#185c50', points: [{ x: 25, y: 40, pressure: 0.5 }, { x: 40, y: 55, pressure: 0.8 }], width: 2, createdAt: date });
  repo.state.activeSetId = 'set-a'; repo.state.activeDocumentId = 'doc-b';
  const review = createReview(repo.state, 'card-0', '这段内容如何解释？');
  scheduleReview(repo.state, review.id, 'good', date);
  validateState(repo.state);
  return { repo, store };
}

describe('来源坐标独立于屏幕、旋转和缩放', () => {
  for (const scale of [0.5, 1, 2.75]) for (const rotation of [0, 90, 180, 270]) {
    it(`页面裁切偏移和 ${rotation}° / ${scale} 倍缩放往返`, () => {
      const x = 36, y = 48, width = 600, height = 800;
      const transforms: Record<number, number[]> = {
        0: [scale, 0, 0, -scale, -x * scale, (y + height) * scale],
        90: [0, scale, scale, 0, -y * scale, -x * scale],
        180: [-scale, 0, 0, scale, (x + width) * scale, -y * scale],
        270: [0, -scale, -scale, 0, (y + height) * scale, (x + width) * scale],
      };
      const m = transforms[rotation];
      for (const point of [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }, { x: 104.125, y: 531.75 }]) {
        const result = viewportToPdf(pdfToViewport(point, m), m);
        expect(result.x).toBeCloseTo(point.x, 10); expect(result.y).toBeCloseTo(point.y, 10);
      }
      const rect: [number, number, number, number] = [44.5, 133.25, 455.75, 378.5];
      const result = viewportRectToPdf(pdfRectToViewport(rect, m), m);
      result.forEach((value, i) => expect(value).toBeCloseTo(rect[i], 10));
    });
  }
  it('拒绝不可逆矩阵并正确命中橡皮路径', () => {
    expect(() => viewportToPdf({ x: 1, y: 1 }, [0, 0, 0, 0, 0, 0])).toThrow();
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 6, y: 0 })).toBe(4);
    expect(distanceToSegment({ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('本地数据可靠性', () => {
  it('并发相同资源合并底层写入及元数据，不同资源仍可并行且重启可读', async () => {
    const store = new DelayedStore(), repo = new Repository(store);
    const a = new Uint8Array([137,80,78,71,1]), b = new Uint8Array([137,80,78,71,2]);
    const assets = await Promise.all([repo.addAsset(a, 'image/png'), repo.addAsset(a, 'image/png'), repo.addAsset(b, 'image/png'), repo.addAsset(a, 'image/png')]);
    expect(assets[0].id).toBe(assets[1].id); expect(assets[0].id).toBe(assets[3].id); expect(assets[0].id).not.toBe(assets[2].id);
    expect(store.writeCounts.get(assets[0].path)).toBe(1); expect(store.writeCounts.get(assets[2].path)).toBe(1);
    expect(store.maximumActiveWrites).toBe(2); expect(repo.state.assets).toHaveLength(2);
    await repo.save(); const reopened = new Repository(store); await reopened.load();
    expect(await reopened.assetBytes(assets[0].id)).toEqual(a); expect(await reopened.assetBytes(assets[2].id)).toEqual(b);
  });
  it('并发资源写入失败共同拒绝并清除in-flight，随后可重试保存', async () => {
    const store = new DelayedStore(), repo = new Repository(store), bytes = new Uint8Array([137,80,78,71,9]);
    store.interruptNextWrite = true;
    const attempts = await Promise.allSettled([repo.addAsset(bytes, 'image/png'), repo.addAsset(bytes, 'image/png')]);
    expect(attempts.every(result => result.status === 'rejected')).toBe(true);
    expect(repo.state.assets).toHaveLength(0);
    expect([...store.writeCounts.values()]).toEqual([1]);
    const asset = await repo.addAsset(bytes, 'image/png');
    expect(store.writeCounts.get(asset.path)).toBe(2); expect(repo.state.assets).toHaveLength(1);
    await repo.save(); const reopened = new Repository(store); await reopened.load(); expect(await reopened.assetBytes(asset.id)).toEqual(bytes);
  });
  it('重建Repository恢复20张卡片、资源、阅读状态和复习记录', async () => {
    const { repo, store } = await fixture();
    await repo.save();
    const reopened = new Repository(store);
    await reopened.load();
    expect(reopened.state.cards).toHaveLength(20);
    expect(reopened.state.documents[1].progress).toEqual({ page: 2, zoom: 1.75, rotation: 90 });
    expect(reopened.state.reviewLogs[0].rating).toBe('good');
    expect(decodeUtf8(await reopened.assetBytes(reopened.state.documents[0].assetId))).toContain('%PDF-');
  });
  it('写入中断保留前一完整修订并报告恢复', async () => {
    const { repo, store } = await fixture();
    await repo.save();
    repo.state.sets[0].name = '第二次成功'; await repo.save();
    repo.state.sets[0].name = '第三次中断'; store.interruptNextWrite = true;
    await expect(repo.save()).rejects.toThrow('中断');
    const reopened = new Repository(store); await reopened.load();
    expect(reopened.state.sets[0].name).toBe('第二次成功');
    expect(reopened.recoveryWarning).toContain('恢复');
  });
  it('调用时捕获状态，快速连存仍保持正确修订顺序', async () => {
    const { repo, store } = await fixture();
    repo.state.sets[0].name = '保存A'; const a = repo.save();
    repo.state.sets[0].name = '保存B'; const b = repo.save();
    await Promise.all([a, b]);
    const snapshotA = JSON.parse(decodeUtf8((await store.read('snapshot-a.json'))!));
    const snapshotB = JSON.parse(decodeUtf8((await store.read('snapshot-b.json'))!));
    expect(snapshotA.state.sets[0].name).toBe('保存A'); expect(snapshotA.revision).toBe(1);
    expect(snapshotB.state.sets[0].name).toBe('保存B'); expect(snapshotB.revision).toBe(2);
  });
  it('连续失败重试始终保留唯一成功槽，而不按修订奇偶覆盖', async () => {
    const { repo, store } = await fixture(); await repo.save();
    const originalName = repo.state.sets[0].name;
    for (let attempt = 0; attempt < 3; attempt++) {
      repo.state.sets[0].name = `未成功修订 ${attempt}`; store.interruptNextWrite = true;
      await expect(repo.save()).rejects.toThrow('中断');
    }
    const reopened = new Repository(store); await reopened.load();
    expect(reopened.state.sets[0].name).toBe(originalName);
  });
  it('未来版本存在时拒绝降级覆盖，两槽损坏时拒绝空库启动', async () => {
    const { repo, store } = await fixture(); await repo.save();
    const future = { ...repo.state, schemaVersion: 99, revision: 2 };
    await store.write('snapshot-b.json', utf8(JSON.stringify({ format: 'mojing.snapshot', revision: 2, sha256: await sha256(utf8(JSON.stringify(future))), state: future })));
    await expect(new Repository(store).load()).rejects.toThrow('较新数据库');
    await store.write('snapshot-a.json', utf8('bad')); await store.write('snapshot-b.json', utf8('bad'));
    await expect(new Repository(store).load()).rejects.toThrow('两份');
  });
  it('按明确版本迁移，保持稳定ID，拒绝损坏资源', async () => {
    const state = { ...emptyState(), schemaVersion: 0 } as State;
    const migrated = migrateState(state); expect(migrated.schemaVersion).toBe(1);
    expect(state.schemaVersion).toBe(0);
    const { repo, store } = await fixture();
    const asset = repo.state.assets[0]; await store.write(asset.path, utf8('changed'));
    await expect(repo.assetBytes(asset.id)).rejects.toThrow('校验失败');
  });
});

describe('脑图和复习关系', () => {
  it('阻止自环和后代循环，允许移动为同级或根节点', async () => {
    const { repo } = await fixture();
    expect(() => moveNode(repo.state, 'node-0', 'node-2')).toThrow('子孙');
    expect(repo.state.nodes[0].parentId).toBeNull();
    moveNode(repo.state, 'node-2', null); validateState(repo.state);
    expect(repo.state.nodes[2].parentId).toBeNull();
    repo.state.nodes[0].parentId = 'node-1';
    expect(() => validateState(repo.state)).toThrow('循环');
  });
  it('删除卡片提升孩子、删除关联复习；删除PDF保留摘录内容和来源说明', async () => {
    const { repo } = await fixture();
    deleteCard(repo.state, 'card-1'); validateState(repo.state);
    expect(repo.state.nodes.find(n => n.id === 'node-2')?.parentId).toBe('node-0');
    deleteCard(repo.state, 'card-0'); validateState(repo.state);
    expect(repo.state.reviewLogs).toHaveLength(0);
    deleteDocument(repo.state, 'doc-b'); validateState(repo.state);
    expect(repo.state.cards.find(c => c.id === 'card-3')?.orphanedSource).toContain('扫描资料.pdf');
    expect(repo.state.cards.find(c => c.id === 'card-3')?.source).toBeUndefined();
    expect(repo.state.annotations.some(a => a.documentId === 'doc-b')).toBe(false);
  });
  it('四档反馈保存下次复习时间与历史，未掌握10分钟后再现', async () => {
    const { repo } = await fixture();
    const review = repo.state.reviews[0];
    const log = scheduleReview(repo.state, review.id, 'again', '2026-11-04T03:00:00.000Z');
    expect(log.nextDueAt).toBe('2026-11-04T03:10:00.000Z');
    expect(review.repetitions).toBe(0);
    scheduleReview(repo.state, review.id, 'easy', '2026-11-04T03:10:00.000Z');
    expect(review.dueAt).toBe('2026-11-08T03:10:00.000Z'); validateState(repo.state);
  });
  it('同一卡片嵌套引用按任意顺序存储，删除时提升到最近存活祖先', async () => {
    const { repo } = await fixture();
    repo.state.nodes = [
      { id: 'surviving-child', setId: 'set-a', cardId: 'card-2', parentId: 'removed-child', order: 0, collapsed: false },
      { id: 'removed-child', setId: 'set-a', cardId: 'card-1', parentId: 'removed-parent', order: 0, collapsed: false },
      { id: 'removed-parent', setId: 'set-a', cardId: 'card-1', parentId: 'surviving-root', order: 0, collapsed: false },
      { id: 'surviving-root', setId: 'set-a', cardId: 'card-0', parentId: null, order: 0, collapsed: false },
    ];
    deleteCard(repo.state, 'card-1'); validateState(repo.state);
    expect(repo.state.nodes.find(n => n.id === 'surviving-child')?.parentId).toBe('surviving-root');
  });
});

describe('完整学习集交换', () => {
  it('跨独立FileStore恢复全部内容，重复导入复制ID且保留三级关系与来源', async () => {
    const { repo } = await fixture();
    const archive = await exportStudySet(repo, 'set-a');
    const target = new Repository(new MemoryStore());
    const first = await importStudySet(target, archive);
    expect(first.cardCount).toBe(20); expect(first.documentCount).toBe(2);
    expect(target.state.sets[0].id).not.toBe('set-a');
    const child = target.state.nodes[2], parent = target.state.nodes.find(n => n.id === child.parentId)!;
    expect(target.state.nodes.find(n => n.id === parent.parentId)?.parentId).toBeNull();
    const source = target.state.cards[0].source!;
    expect(source.rects).toEqual([[36,125,267,150]]);
    expect(target.state.documents.find(d => d.id === source.documentId)?.name).toContain('含文字层');
    expect(target.state.annotations).toHaveLength(2); expect(target.state.reviewLogs).toHaveLength(1);
    const idsBefore = target.state.cards.map(c => c.id);
    const second = await importStudySet(target, archive);
    expect(second.setId).not.toBe(first.setId);
    expect(target.state.cards).toHaveLength(40); expect(target.state.assets).toHaveLength(3);
    expect(target.state.cards.slice(20).every(c => !idsBefore.includes(c.id))).toBe(true);
    const reopened = new Repository(target.store); await reopened.load(); validateState(reopened.state);
    expect(reopened.state.sets).toHaveLength(2);
  });
  it('包内容篡改被拒绝且原库无变化', async () => {
    const { repo } = await fixture();
    const files = unzipSync(await exportStudySet(repo, 'set-a'));
    files['study.json'] = utf8(decodeUtf8(files['study.json']).replace('中文学习集', '被篡改数据'));
    const before = JSON.stringify(repo.state);
    await expect(importStudySet(repo, zipSync(files))).rejects.toThrow('完整性');
    expect(JSON.stringify(repo.state)).toBe(before);
  });
  it('路径穿越、缺少资源清单和未来格式均拒绝', async () => {
    expect(() => unpackArchive(zipSync({ '../escape': utf8('bad') }))).toThrow('不安全');
    const { repo } = await fixture();
    const files = unzipSync(await exportStudySet(repo, 'set-a'));
    const manifest = JSON.parse(decodeUtf8(files['manifest.json'])); manifest.version = 99;
    files['manifest.json'] = utf8(JSON.stringify(manifest));
    await expect(importStudySet(repo, zipSync(files))).rejects.toThrow('版本');
    delete files['study.json'];
    await expect(importStudySet(repo, zipSync(files))).rejects.toThrow('缺少');
  });
  it('Markdown离线包包含可解析的图片/PDF来源和所有卡片', async () => {
    const { repo } = await fixture();
    const files = unzipSync(await exportMarkdownBundle(repo, 'set-a'));
    const markdown = decodeUtf8(files['笔记.md']);
    expect(markdown.match(/^## /gm)).toHaveLength(20);
    expect(markdown).toContain('第 2 页'); expect(markdown).toContain('PDF 区域');
    for (const asset of repo.state.assets) expect(files[asset.path]).toBeDefined();
  });
});
