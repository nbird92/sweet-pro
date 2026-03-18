import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebaseConfig';

export async function uploadQAFile(
  productId: string,
  category: 'packaging' | 'artwork' | 'upc',
  file: File
): Promise<{ url: string; filename: string }> {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `qa/${productId}/${category}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
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
