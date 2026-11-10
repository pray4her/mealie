import type { MembershipMutation } from './family';

export type MediaPurpose = 'recipe-image' | 'import-input';
export type MediaMime = 'image/jpeg' | 'image/png';
export type MediaState = 'requested' | 'uploading' | 'uploaded' | 'checking' | 'pending' | 'ready' | 'rejected' | 'review-error' | 'failed';
export type MediaContext = { familyId: string; generation: string };
export type MediaUploadRequest = MembershipMutation & { purpose: MediaPurpose; mime: MediaMime; bytes: number };
export type MediaRef = MediaContext & { mediaId: string };
export type MediaUpload = MediaRef & { base64: string };
export type MediaView = { mediaId: string; state: MediaState; uploadExpiresAt: number; review: 'disabled' | 'weixin' | 'mock'; retryable: boolean };
export type MediaLink = { mediaId: string; url: string; expiresAt: number };
export interface MediaApi {
  requestUpload(input: MediaUploadRequest): Promise<MediaView>;
  upload(input: MediaUpload): Promise<MediaView>;
  complete(input: MediaRef): Promise<MediaView>;
  status(input: MediaContext & { mediaIds: string[] }): Promise<MediaView[]>;
  read(input: MediaRef): Promise<MediaLink>;
}
