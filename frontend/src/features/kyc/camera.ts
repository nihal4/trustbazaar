// The camera for the KYC wizard (FR-KYC-02, IF-SW-07; section 5.2). Only kyc.html may use it
// (Permissions-Policy camera=(self)). A captured frame becomes a JPEG Blob held in memory; nothing is
// written to browser storage. Screens get the camera from CameraContext, so tests can give a stand-in;
// the real camera is checked by the end-to-end run with Chromium's fake camera (U8-11).
import { createContext, useContext } from 'react';

export type Facing = 'user' | 'environment';
export type CameraProblem = 'denied' | 'missing' | 'failed';

export interface Camera {
  open(facing: Facing): Promise<MediaStream>;
  capture(video: HTMLVideoElement): Promise<Blob>;
}

export const browserCamera: Camera = {
  open(facing) {
    if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(Object.assign(new Error('no camera API'), { name: 'NotFoundError' }));
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  },
  capture(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) return Promise.reject(new Error('camera not ready'));
    ctx.drawImage(video, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/jpeg', 0.92));
  },
};

/** Why the camera could not start, from the error getUserMedia gives. */
export function cameraProblem(e: unknown): CameraProblem {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'failed';
}

export const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

export const CameraContext = createContext<Camera>(browserCamera);
export const useCamera = () => useContext(CameraContext);

/** CP-33: 10 MB per image, checked before sending; the server checks again. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
