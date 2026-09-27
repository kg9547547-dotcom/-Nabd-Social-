import fs from 'fs';
import path from 'path';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc
} from 'firebase/firestore';

let firestoreDb: ReturnType<typeof getFirestore> | null = null;

function getServerFirestore() {
  if (firestoreDb) return firestoreDb;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const firebaseConfig = JSON.parse(raw);
    if (!firebaseConfig.projectId || !firebaseConfig.apiKey) return null;
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    return firestoreDb;
  } catch (err) {
    console.warn('Firestore server init warning:', err);
    return null;
  }
}

const CHUNK_SIZE_CHARS = 700_000; // ~700KB base64 per Firestore document (well under 1MB limit)
let cloudSyncTimer: NodeJS.Timeout | null = null;
let isSyncingToCloud = false;

/**
 * Restores the SQLite database binary from Firestore `/nabd_cloud_backup` if local disk was reset
 * or if the cloud backup is newer than the local disk file.
 */
export async function restoreDatabaseFromFirestoreIfNeeded(dbPath: string): Promise<boolean> {
  const fdb = getServerFirestore();
  if (!fdb) return false;

  try {
    const snap = await getDocs(collection(fdb, 'nabd_cloud_backup'));
    if (snap.empty) return false;

    const chunks: { chunkIndex: number; totalChunks: number; dataBase64: string; updatedAt: number }[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      if (typeof data.chunkIndex === 'number' && typeof data.dataBase64 === 'string') {
        chunks.push({
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks || 1,
          dataBase64: data.dataBase64,
          updatedAt: data.updatedAt || 0
        });
      }
    });

    if (chunks.length === 0) return false;
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    const expectedTotal = chunks[0].totalChunks;
    if (chunks.length < expectedTotal) return false;

    const cloudUpdatedAt = chunks[0].updatedAt || 0;
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      // If local file exists and is newer or equal, keep local file
      if (stat.size > 4096 && stat.mtimeMs >= cloudUpdatedAt) {
        return false;
      }
    }

    const combinedBase64 = chunks.slice(0, expectedTotal).map((c) => c.dataBase64).join('');
    const buffer = Buffer.from(combinedBase64, 'base64');
    if (buffer.length > 1024) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(dbPath, buffer);
      console.log(`[Firestore Cloud Persistence] Restored database (${buffer.length} bytes) from Firestore.`);
      return true;
    }
  } catch (err) {
    console.warn('[Firestore Cloud Persistence] Restore check skipped:', err instanceof Error ? err.message : err);
  }
  return false;
}

/**
 * Mirrors the SQLite binary buffer to Firestore `/nabd_cloud_backup` so server restarts never lose data.
 */
export function scheduleCloudBackup(getDbBinary: () => Uint8Array | null, immediate = false) {
  const executeSync = async () => {
    if (isSyncingToCloud) return;
    const fdb = getServerFirestore();
    if (!fdb) return;
    const binary = getDbBinary();
    if (!binary || binary.length === 0) return;

    isSyncingToCloud = true;
    try {
      const base64 = Buffer.from(binary).toString('base64');
      const totalChunks = Math.ceil(base64.length / CHUNK_SIZE_CHARS) || 1;
      // Avoid exceeding reasonable chunk count if huge media was stored inside sqlite
      if (totalChunks > 25) {
        isSyncingToCloud = false;
        return;
      }
      const now = Date.now();
      for (let i = 0; i < totalChunks; i++) {
        const slice = base64.slice(i * CHUNK_SIZE_CHARS, (i + 1) * CHUNK_SIZE_CHARS);
        await setDoc(doc(fdb, 'nabd_cloud_backup', `chunk-${i}`), {
          chunkIndex: i,
          totalChunks,
          dataBase64: slice,
          updatedAt: now
        });
      }
    } catch (err) {
      // Ignore transient network/quota errors; local SQLite file is already saved
    } finally {
      isSyncingToCloud = false;
    }
  };

  if (immediate) {
    if (cloudSyncTimer) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    executeSync();
    return;
  }

  if (cloudSyncTimer) return;
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    executeSync();
  }, 1500);
}

/**
 * Mirrors key entities (users, reels, follows, private_messages, wall_posts) directly to Firestore collections.
 */
export async function syncRecordToFirestore(
  collectionName: 'users' | 'reels' | 'follows' | 'private_messages' | 'wall_posts',
  docId: string,
  data: Record<string, any>
) {
  const fdb = getServerFirestore();
  if (!fdb || !docId) return;
  try {
    const cleanId = String(docId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    await setDoc(doc(fdb, collectionName, cleanId), data, { merge: true });
  } catch {
    // Non-blocking cloud mirror
  }
}

export async function deleteRecordFromFirestore(
  collectionName: 'users' | 'reels' | 'follows' | 'private_messages' | 'wall_posts',
  docId: string
) {
  const fdb = getServerFirestore();
  if (!fdb || !docId) return;
  try {
    const cleanId = String(docId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    await deleteDoc(doc(fdb, collectionName, cleanId));
  } catch {
    // Non-blocking
  }
}
