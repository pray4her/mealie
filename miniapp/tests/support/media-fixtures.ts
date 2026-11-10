import { createHarness } from './harness';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');
export function paddedPng(length: number) {
  const size = length - png.length - 12; if (size < 4) throw new Error('Padding too small');
  const chunk = Buffer.alloc(size + 12, 97); chunk.writeUInt32BE(size); chunk.write('tEXt', 4); chunk.write('pad\0', 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
let sequence = 0;
export const request = () => 'media-request-' + String(++sequence).padStart(8, '0');
export const recipeInput = () => ({ title: '图片菜谱', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] });
export async function mediaFixture(options: Parameters<typeof createHarness>[0] = {}) {
  const h = createHarness(options);
  for (const uid of ['owner', 'member', 'outsider']) await h.seedIdentity({ uid });
  const owner = h.client('owner'); const member = h.client('member'); const outsider = h.client('outsider');
  const home = await owner.family.create({ requestId: request(), name: '家' });
  const invitation = await owner.family.invite({ requestId: request() });
  const joined = await member.family.join({ requestId: request(), token: invitation.token });
  const other = await outsider.family.create({ requestId: request(), name: '另一家' });
  const scope = { familyId: home.familyId, generation: home.generation };
  const memberScope = { familyId: joined.familyId, generation: joined.generation };
  const allocate = (purpose: 'recipe-image' | 'import-input' = 'recipe-image') => owner.media.requestUpload({ ...scope, requestId: request(), purpose, mime: 'image/png', bytes: png.length });
  const upload = async (purpose: 'recipe-image' | 'import-input' = 'recipe-image') => {
    const media = await allocate(purpose); const ref = { ...scope, mediaId: media.mediaId };
    await owner.media.upload({ ...ref, base64: png.toString('base64') }); return owner.media.complete(ref);
  };
  const recipe = () => owner.recipes.create({ ...scope, requestId: request(), recipe: recipeInput() });
  return { h, owner, member, outsider, home, joined, other, scope, memberScope, allocate, upload, recipe };
}

export const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==', 'base64');
