import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebaseConfig';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s. Check Firebase Storage rules allow authenticated writes.`)), ms)
    ),
  ]);
}

export async function uploadQAFile(
  productId: string,
  category: 'packaging' | 'artwork' | 'upc',
  file: File
): Promise<{ url: string; filename: string }> {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `qa/${productId}/${category}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);
  await withTimeout(uploadBytes(storageRef, file), 30000, 'Upload');
  const url = await withTimeout(getDownloadURL(storageRef), 10000, 'Get download URL');
  return { url, filename: file.name };
}

export async function deleteQAFile(downloadUrl: string): Promise<void> {
  try {
    const storageRef = ref(storage, downloadUrl);
    await deleteObject(storageRef);
  } catch (e) {
    console.error('Failed to delete file from storage:', e);
  }
}
