// File upload utilities - stores files as base64 data URLs in Firestore
// This bypasses Firebase Storage (which requires separate security rules)
// and uses the same Firestore persistence that already works for all app data.

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per file (base64 adds ~33% overhead, Firestore doc limit is 1MB)

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function uploadQAFile(
  _productId: string,
  _category: 'packaging' | 'artwork' | 'upc',
  file: File
): Promise<{ url: string; filename: string }> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 2MB.`);
  }
  const url = await fileToDataUrl(file);
  return { url, filename: file.name };
}

export async function deleteQAFile(_downloadUrl: string): Promise<void> {
  // No-op: data URLs are stored inline in Firestore documents.
  // Removing from the document array is all that's needed.
}
