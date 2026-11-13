import type { ImportError, ImportInput, ImportsApi, ImportSubmit, JobView } from 'home-contracts';
import type { Invoke } from '../family/api';
import type { SessionBoundary } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, validId } from '../recipes/validation';
import { membershipInput } from '../family/membership-validation';

export const importErrors: Record<ImportError, string> = {
  UNRECOGNIZED: '未能识别一道完整菜谱，请提供包含食材和做法的清晰素材后重新导入。', MULTIPLE_RECIPES: '素材包含多道菜，请每次只导入一道菜。',
  INVALID_OUTPUT: 'AI 返回的菜谱格式不符合要求，请调整素材后重新导入。', TRUNCATED: 'AI 结果过长被截断，请减少内容或分开导入。',
  PROVIDER_UNAVAILABLE: 'AI 服务暂时不可用，请稍后重新导入。', AUDIT_REJECTED: '菜谱未通过内容审核，请修改内容或更换素材后重新导入。',
  AUDIT_UNAVAILABLE: '内容审核暂时不可用，请重新打开小程序后重新导入。', AUDIT_VISIT_REQUIRED: '微信审核需要近两小时访问过小程序，请现在重新导入。',
  MEMBERSHIP_CHANGED: '家庭成员身份已变化，任务无法继续，请确认家庭后重新导入。', BUDGET_EXCEEDED: 'AI 预算已用尽，请稍后重新导入。', INPUT_EXPIRED: '任务原始素材已到保留上限，请重新导入。',
  IMAGE_UNREADABLE: '图片无法读取或已损坏，请重新选择清晰完整的菜谱图片。',
  SOURCE_UNREADABLE: '无法读取这个网址（可能需登录、付费或拒绝访问）。请复制网页正文，用“粘贴正文”重新导入。',
};
export function textInput(value: unknown): string {
  // eslint-disable-next-line no-control-regex -- Same explicit control ranges as recipe forms, compatible with mini-programs.
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001F\u007F-\u009F]/.test(value.replace(/[\n\r\t]/g, '')) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new AppError('INVALID_INPUT');
  if (encodeURIComponent(value).replace(/%[A-F0-9]{2}|./g, 'x').length > 16384) throw new AppError('INVALID_INPUT'); return value;
}
export function urlInput(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('INVALID_INPUT');
  const url = value.trim();
  // eslint-disable-next-line no-control-regex -- Same explicit control ranges as recipe forms, compatible with mini-programs.
  if (!url || url.length > 2048 || /[\s\u0000-\u001F\u007F-\u009F]/.test(url)) throw new AppError('INVALID_INPUT');
  const match = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(url);
  if (!match || match[2].includes('@') || match[2].includes('\\')) throw new AppError('INVALID_INPUT');
  const port = /:(\d+)$/.exec(match[2]);
  if (port && port[1] !== (match[1].toLowerCase() === 'https' ? '443' : '80')) throw new AppError('INVALID_INPUT');
  const host = match[2].replace(/:\d+$/, '').toLowerCase();
  if (!host || host === 'localhost' || host === 'metadata.google.internal' || /\.(localhost|local|internal|lan|home\.arpa|corp)$/.test(host)) throw new AppError('INVALID_INPUT');
  return url;
}
export function importSource(raw: unknown): ImportInput {
  if (raw && typeof raw === 'object' && 'kind' in raw) {
    if (raw.kind === 'image') { const row = object(raw, ['kind', 'mediaId']); return { kind: 'image', mediaId: validId(row.mediaId) }; }
    if (raw.kind === 'url') { const row = object(raw, ['kind', 'url']); return { kind: 'url', url: urlInput(row.url) }; }
  }
  const row = object(raw, ['kind', 'text']);
  if (row.kind !== 'text') throw new AppError('UNAVAILABLE');
  return { kind: 'text', text: textInput(row.text) };
}
export function submitInput(raw: unknown): ImportSubmit {
  const row = object(raw, ['requestId', 'familyId', 'generation', 'source']); const { source, ...scope } = row;
  return { ...membershipInput('leave', scope), source: importSource(source) };
}
export function parseJob(raw: unknown): JobView {
  try {
    const row = object(raw, ['id', 'state', 'attempts', 'recipeId', 'createdAt', 'updatedAt', 'error']); validId(row.id);
    if (!['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(String(row.state)) || !Number.isSafeInteger(row.attempts) || (row.attempts as number) < 0 || (row.attempts as number) > 3) throw new Error();
    for (const key of ['createdAt', 'updatedAt']) if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) throw new Error();
    if ((row.updatedAt as number) < (row.createdAt as number)) throw new Error();
    if (row.state === 'succeeded') validId(row.recipeId); else if (row.recipeId !== null) throw new Error();
    if (row.state === 'failed') { if (typeof row.error !== 'string' || !Object.hasOwn(importErrors, row.error)) throw new Error(); }
    else if (row.error !== null) throw new Error();
    return row as JobView;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function createImportsApi({ invoke, boundary }: { invoke: Invoke; boundary: SessionBoundary }): ImportsApi {
  async function call(method: string, input: unknown) {
    try { return parseJob(await invoke('imports-co', method, input)); }
    catch (error) { if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {}); throw new AppError(errorCode(error)); }
  }
  return { submit(input) { return call('submit', submitInput(input)); }, get(id) { return call('get', validId(id)); }, cancel(input) {
    const { id, ...scope } = object(input, ['requestId', 'familyId', 'generation', 'id']); return call('cancel', { ...membershipInput('leave', scope), id: validId(id) });
  } };
}
