import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { FileStore } from '../core/model';

export const toBase64 = (bytes: Uint8Array) => {
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
};
export const fromBase64 = (s: string) => {
  const binary = atob(s); const bytes = new Uint8Array(binary.length);
  // TypedArray.from(string, callback) first expands a large iterable on older
  // Android WebViews. A single allocated buffer avoids that memory/CPU spike.
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
declare global { interface Window { mojing?: { read(path: string): Promise<string | null>; write(path: string, base64: string): Promise<void>; remove(path: string): Promise<void>; exportFile(name: string, base64: string): Promise<boolean>; platform: string; onBeforeClose(callback: () => Promise<void>): () => void } } }

class BrowserStore implements FileStore {
  private db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mojing-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  async read(path: string) { const db = await this.db; return new Promise<Uint8Array | null>((resolve, reject) => { const tx = db.transaction('files'); const req = tx.objectStore('files').get(path); req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null); req.onerror = () => reject(req.error); }); }
  async write(path: string, data: Uint8Array) { const db = await this.db; return new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(data, path); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  async remove(path: string) { const db = await this.db; return new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(path); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
}
export function createFileStore(): FileStore {
  if (window.mojing) return { async read(path) { const s = await window.mojing!.read(path); return s === null ? null : fromBase64(s); }, write: (path, b) => window.mojing!.write(path, toBase64(b)), remove: path => window.mojing!.remove(path) };
  if (Capacitor.isNativePlatform()) return {
    async read(path) { try { const r = await Filesystem.readFile({ path, directory: Directory.Data }); return typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer()); } catch (e) { if (/not exist|not found|ENOENT/i.test(String((e as Error).message))) return null; throw e; } },
    async write(path, b) { await Filesystem.writeFile({ path, directory: Directory.Data, data: toBase64(b), recursive: true }); },
    async remove(path) { await Filesystem.deleteFile({ path, directory: Directory.Data }); },
  };
  return new BrowserStore();
}
const FileExchange = registerPlugin<{ saveFile(options: { name: string; data: string; mime: string }): Promise<{ saved: boolean }> }>('FileExchange');
export async function saveExternal(name: string, bytes: Uint8Array, mime: string) {
  if (window.mojing) return window.mojing.exportFile(name, toBase64(bytes));
  if (Capacitor.isNativePlatform()) return (await FileExchange.saveFile({ name, data: toBase64(bytes), mime })).saved;
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); return true;
}
