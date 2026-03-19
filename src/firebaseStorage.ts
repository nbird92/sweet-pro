// File upload utilities - stores files as compressed base64 data URLs in Firestore.
// Images are resized and compressed to stay within Firestore's 1MB document limit.
// Non-image files (PDFs, docs) are stored as-is with a tight size limit.

const MAX_IMAGE_DIMENSION = 800; // Max width or height in pixels
const JPEG_QUALITY = 0.6; // JPEG compression quality (0-1)
const MAX_NON_IMAGE_SIZE = 400 * 1024; // 400KB for PDFs/docs (base64 adds ~33%)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB input (will be compressed)

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Compress an image file using canvas — returns a small JPEG data URL */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Scale down if either dimension exceeds the max
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Use JPEG for photos, PNG for transparency
      const isPng = file.type === 'image/png';
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const quality = isPng ? undefined : JPEG_QUALITY;

      const dataUrl = canvas.toDataURL(mimeType, quality);

      // If PNG is still too large, fall back to JPEG
      if (isPng && dataUrl.length > 150_000) {
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } else {
        resolve(dataUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = objectUrl;
  });
}

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
  if (isImageFile(file)) {
    // Images: compress via canvas (any reasonable input size)
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(`Image "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
    }
    const url = await compressImage(file);
    return { url, filename: file.name };
  } else {
    // Non-image files (PDF, doc, etc): store as-is with tight limit
    if (file.size > MAX_NON_IMAGE_SIZE) {
      throw new Error(`File "${file.name}" is too large (${(file.size / 1024).toFixed(0)}KB). Maximum for documents is 400KB. Try compressing the PDF first.`);
    }
    const url = await fileToDataUrl(file);
    return { url, filename: file.name };
  }
}

export async function deleteQAFile(_downloadUrl: string): Promise<void> {
  // No-op: data URLs are stored inline in Firestore documents.
  // Removing from the document array is all that's needed.
}
