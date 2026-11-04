export const SCHEMA_VERSION = 1;
export type Rect = [number, number, number, number]; // PDF user space, unrotated; x1,y1,x2,y2
export type Point = { x: number; y: number; pressure?: number };
export interface Source { documentId: string; page: number; rects: Rect[]; quote?: string }
export interface StudySet { id: string; name: string; documentIds: string[]; createdAt: string }
export interface Document { id: string; name: string; assetId: string; pageCount: number; createdAt: string; progress: { page: number; zoom: number; rotation: number } }
export interface Card { id: string; setId: string; title: string; body: string; imageAssetId?: string; color: string; tags: string[]; source?: Source; orphanedSource?: string; createdAt: string; updatedAt: string }
export interface Annotation { id: string; setId: string; documentId: string; page: number; kind: 'highlight' | 'ink'; color: string; rects?: Rect[]; points?: Point[]; width?: number; createdAt: string }
export interface MindNode { id: string; setId: string; cardId: string; parentId: string | null; order: number; collapsed: boolean }
export interface Review { id: string; cardId: string; setId: string; question: string; dueAt: string; interval: number; repetitions: number }
export interface ReviewLog { id: string; reviewId: string; cardId: string; setId: string; rating: 'again' | 'hard' | 'good' | 'easy'; reviewedAt: string; nextDueAt: string }
export interface Asset { id: string; path: string; mime: string; size: number; sha256: string }
export interface State { schemaVersion: number; revision: number; sets: StudySet[]; documents: Document[]; cards: Card[]; annotations: Annotation[]; nodes: MindNode[]; reviews: Review[]; reviewLogs: ReviewLog[]; assets: Asset[]; activeSetId?: string; activeDocumentId?: string }
export interface FileStore { read(path: string): Promise<Uint8Array | null>; write(path: string, data: Uint8Array): Promise<void>; remove(path: string): Promise<void> }
export const emptyState = (): State => ({ schemaVersion: SCHEMA_VERSION, revision: 0, sets: [], documents: [], cards: [], annotations: [], nodes: [], reviews: [], reviewLogs: [], assets: [] });
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
