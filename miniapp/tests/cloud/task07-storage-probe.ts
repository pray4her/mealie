import { createHash, timingSafeEqual } from 'node:crypto';

export interface StorageProbePort {
  uploadFile(input: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  downloadFile(input: { fileID: string }): Promise<{ fileContent?: Buffer }>;
  getTempFileURL(input: { fileList: string[]; maxAge: number }): Promise<{ fileList?: { fileID: string; tempFileURL?: string; status?: number }[] }>;
  deleteFile(input: { fileList: string[] }): Promise<{ fileList?: { fileID: string; status?: number; code?: string | number }[] }>;
}

export function createStorageProbe({ cloud, prefix, spaceId, sample, capabilityHash }: { cloud: StorageProbePort; prefix: string; spaceId: string; sample: Buffer; capabilityHash: string }) {
  if (!/^task07-private\/task07-probe-[a-f0-9]{12}$/.test(prefix) || !/^[a-f0-9]{64}$/.test(capabilityHash)) throw new Error('Invalid probe scope');
  const paths = [`${prefix}/sample.png`, `${prefix}/nested/sample.png`];
  const fileIds = paths.map(path => `cloud://${spaceId}/${path}`);
  const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const sampleHash = digest(sample);
  return async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !('capability' in input)
      || typeof input.capability !== 'string' || !/^[a-f0-9]{64}$/.test(input.capability)
      || !timingSafeEqual(Buffer.from(digest(input.capability), 'hex'), Buffer.from(capabilityHash, 'hex'))) {
      return { ok: false, errorCode: 'FORBIDDEN' };
    }
    if (Object.keys(input).length !== 2 || !('operation' in input) || typeof input.operation !== 'string'
      || !['seed', 'inspect', 'sign', 'cleanup'].includes(input.operation)) return { ok: false, errorCode: 'INVALID_INPUT' };
    try {
      if (input.operation === 'seed') {
        for (const [index, cloudPath] of paths.entries()) {
          const result = await cloud.uploadFile({ cloudPath, fileContent: sample });
          if (result.fileID !== fileIds[index]) throw new Error('Unexpected storage object');
        }
        return { ok: true, fileIds, sampleHash, bytes: sample.length };
      }
      if (input.operation === 'inspect') {
        const files = [];
        for (const fileID of fileIds) {
          const result = await cloud.downloadFile({ fileID });
          if (!Buffer.isBuffer(result.fileContent)) throw new Error('Invalid download');
          const sha256 = digest(result.fileContent);
          files.push({ fileID, bytes: result.fileContent.length, sha256, matchesSample: sha256 === sampleHash });
        }
        return { ok: true, files };
      }
      if (input.operation === 'sign') {
        const issuedAt = Date.now();
        const result = await cloud.getTempFileURL({ fileList: fileIds, maxAge: 600 });
        const links = fileIds.map(fileID => {
          const file = result.fileList?.find(entry => entry.fileID === fileID);
          if (!file?.tempFileURL?.startsWith('https://') || (file.status !== undefined && file.status !== 0)) throw new Error('Invalid signed link');
          return { fileID, tempFileURL: file.tempFileURL };
        });
        // Signed URLs are returned only to the capability holder; the runner must redact them.
        return { ok: true, issuedAt, links };
      }
      const deleted = await cloud.deleteFile({ fileList: fileIds });
      if (deleted.fileList?.length !== fileIds.length || fileIds.some(fileID => !deleted.fileList?.some(file => file.fileID === fileID && file.status === 0))) {
        return { ok: false, errorCode: 'STORAGE_UNAVAILABLE', deleteResult: { keys: Object.keys(deleted),
          files: deleted.fileList?.map(file => ({ scoped: fileIds.includes(file.fileID), keys: Object.keys(file), status: file.status, code: file.code })) } };
      }
      return { ok: true };
    } catch (error) {
      const code = error && typeof error === 'object' && 'errCode' in error ? error.errCode : undefined;
      return { ok: false, errorCode: 'STORAGE_UNAVAILABLE', ...(typeof code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(code) ? { platformCode: code } : {}) };
    }
  };
}
