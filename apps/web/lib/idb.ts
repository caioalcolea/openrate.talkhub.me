'use client';

// Fila offline de vídeos pendentes de upload (IndexedDB). No iOS não há
// background sync real — a fila é drenada quando o PWA volta ao primeiro plano.

export interface PendingVideo {
  id: string;
  ideaId: string;
  productId: string;
  contentType: string;
  blob: Blob;
  createdAt: number;
}

const DB = 'openrate';
const STORE = 'pending-videos';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putPending(v: PendingVideo): Promise<void> {
  await tx('readwrite', (s) => s.put(v));
}
export async function listPending(): Promise<PendingVideo[]> {
  return tx<PendingVideo[]>('readonly', (s) => s.getAll() as IDBRequest<PendingVideo[]>);
}
export async function deletePending(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}
