import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

function getFirebaseBucket() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }
  return getStorage().bucket();
}

export async function uploadPartnerPhoto(
  buffer: Buffer,
  userId: string,
  placeId: string,
  photoId: string,
): Promise<string> {
  const bucket = getFirebaseBucket();
  const filePath = `partners/${userId}/${placeId}/${photoId}.jpg`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: { contentType: "image/jpeg" },
    public: true,
  });

  const encodedPath = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
}

export async function deletePartnerPhotoFromStorage(
  userId: string,
  placeId: string,
  photoId: string,
): Promise<void> {
  try {
    const bucket = getFirebaseBucket();
    const filePath = `partners/${userId}/${placeId}/${photoId}.jpg`;
    await bucket.file(filePath).delete();
  } catch {
    // Not fatal if file doesn't exist in storage
  }
}
