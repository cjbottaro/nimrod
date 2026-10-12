import { isAttachment, validateImageBlob, validateImageDimensions, type ImageAttachment } from './pi/image-attachments';
import { invoke } from '@tauri-apps/api/core';

const MAX_STORE_BYTES = 128 * 1024 * 1024;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
interface StoredImage { id: string; bytes: ArrayBuffer; mimeType: string; created: number; }

/** IndexedDB transactions serialize quota checks across windows. Never store image bytes in localStorage. */
export class AttachmentStore {
  private database?: Promise<IDBDatabase>;
  constructor(private referenceIds = () => invoke<string[]>('drafts_references')) {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('nimrod.attachments.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(new Error('Could not open image draft storage.')); };
    });
  }
  async put(blob: Blob, name: string): Promise<ImageAttachment> {
    await validateImageDimensions(blob);
    // WebKit can reject Blob persistence even when IndexedDB is available.
    // Store structured-cloneable bytes and reconstruct the Blob on read.
    const imageBytes = await blob.arrayBuffer();
    const image: ImageAttachment = { id: crypto.randomUUID(), name: (name || 'Pasted image').slice(0, 200), mimeType: blob.type, size: blob.size };
    // Failure must disable GC, not authorize deletion of referenced images.
    const references = await this.referenceIds().then(ids => new Set(ids)).catch(() => undefined);
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      const request = store.getAll();
      let error = 'Could not save image draft.';
      request.onsuccess = () => {
        let bytes = 0;
        for (const entry of request.result as StoredImage[]) {
          // The grace period protects other windows' just-written and in-flight drafts.
          if (references && !references.has(entry.id) && entry.created < Date.now() - ORPHAN_GRACE_MS) store.delete(entry.id);
          else bytes += entry.bytes.byteLength;
        }
        if (bytes + blob.size > MAX_STORE_BYTES) { error = 'Image draft storage is full (128 MiB). Remove old drafts or try again after orphan cleanup.'; transaction.abort(); return; }
        const write = store.add({ id: image.id, bytes: imageBytes, mimeType: blob.type, created: Date.now() } satisfies StoredImage);
        write.onerror = () => { error = `Could not save image draft: ${write.error?.name}: ${write.error?.message}`; };
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(new Error(`${error}${transaction.error ? ` ${transaction.error.name}: ${transaction.error.message}` : ''}`));
    });
    return image;
  }
  async get(image: ImageAttachment): Promise<Blob> {
    if (!isAttachment(image)) throw new Error('Invalid image draft reference.');
    const db = await this.open();
    const entry = await new Promise<StoredImage | undefined>((resolve, reject) => {
      const request = db.transaction('images', 'readonly').objectStore('images').get(image.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not read image draft storage.'));
    });
    if (!entry || entry.bytes.byteLength !== image.size || entry.mimeType !== image.mimeType) throw new Error(`Image draft is missing: ${image.name}. Nothing was sent. Compose a new message.`);
    const blob = new Blob([entry.bytes], { type: entry.mimeType });
    validateImageBlob(blob); return blob;
  }
}
