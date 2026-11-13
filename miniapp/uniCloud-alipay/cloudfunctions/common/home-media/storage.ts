import { AppError } from 'home-kernel';
import type { StoragePort } from './index';
export interface StoragePlatform {
  uploadFile(input: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  downloadFile(input: { fileID: string }): Promise<{ fileContent?: Buffer }>;
  getTempFileURL(input: { fileList: string[]; maxAge: number }): Promise<{ fileList?: { fileID: string; tempFileURL?: string; status?: number }[] }>;
  deleteFile(input: { fileList: string[] }): Promise<{ fileList?: { fileID: string; status?: number }[] }>;
}
export function createStoragePort(platform: StoragePlatform, now: () => number, spaceId = 'env-00jy7289et7b'): StoragePort {
  function scoped(id: string) {
    if (!/^cloud:\/\/[^/]+\/task07-private\/[a-f0-9]{32}\/[a-f0-9]{32}\.(?:png|jpg)$/.test(id)) throw new AppError('UNAVAILABLE');
  }
  return {
    async remove(paths) {
      const ids = [...new Set(paths.map(path => path.startsWith('cloud://') ? path : 'cloud://' + spaceId + '/' + path))];
      for (const id of ids) { scoped(id); if (!id.startsWith('cloud://' + spaceId + '/')) throw new AppError('UNAVAILABLE'); }
      const result = await platform.deleteFile({ fileList: ids });
      if (!Array.isArray(result.fileList) || ids.some(id => !result.fileList!.some(row => row.fileID === id && (row.status === undefined || row.status === 0)))) throw new AppError('UNAVAILABLE');
    },
    async upload(path, bytes) {
      if (!/^task07-private\/[a-f0-9]{32}\/[a-f0-9]{32}\.(?:png|jpg)$/.test(path)) throw new AppError('UNAVAILABLE');
      const result = await platform.uploadFile({ cloudPath: path, fileContent: bytes }); scoped(result.fileID);
      if (!result.fileID.endsWith('/' + path)) throw new AppError('UNAVAILABLE'); return result.fileID;
    },
    async read(fileID) {
      scoped(fileID); const result = await platform.downloadFile({ fileID });
      if (!Buffer.isBuffer(result.fileContent) || result.fileContent.length > 1_048_576) throw new AppError('UNAVAILABLE'); return result.fileContent;
    },
    async sign(fileID) {
      scoped(fileID); const result = await platform.getTempFileURL({ fileList: [fileID], maxAge: 600 });
      const row = result.fileList?.find(row => row.fileID === fileID);
      if (!row?.tempFileURL || row.status !== undefined && row.status !== 0) throw new AppError('UNAVAILABLE');
      let url: URL; try { url = new URL(row.tempFileURL); } catch { throw new AppError('UNAVAILABLE'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new AppError('UNAVAILABLE');
      // Alipay encodes the actual expiry in expire_at; never substitute the requested maxAge.
      const expiresAt = Number(url.searchParams.get('expire_at')) * 1000;
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new AppError('UNAVAILABLE');
      return { url: row.tempFileURL, expiresAt };
    },
  };
}
