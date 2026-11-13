import { AppError } from '../../shared/errors';

export async function readImageSelection(chosen: UniApp.ChooseImageSuccessCallbackResult) {
  const path = chosen.tempFilePaths[0]; const file = Array.isArray(chosen.tempFiles) ? chosen.tempFiles[0] : null;
  if (!path || !file || typeof file === 'string' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1_048_576) throw new AppError('INVALID_INPUT');
  const base64 = await new Promise<string>((resolve, reject) => uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64',
    success: result => typeof result.data === 'string' && result.data.length <= 1_398_104 ? resolve(result.data) : reject(new AppError('INVALID_INPUT')),
    fail: () => reject(new AppError('UNAVAILABLE')) }));
  const mime = base64.startsWith('iVBORw0KGgo') ? 'image/png' as const : base64.startsWith('/9j/') ? 'image/jpeg' as const : null;
  if (!mime) throw new AppError('INVALID_INPUT');
  return { path, base64, mime, bytes: file.size };
}
