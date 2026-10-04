import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeProfileAvatar, profileAvatarApi, profileAvatarUrl } from '../../../../apps/web/src/lib/profile-avatar';
import { fetchApi } from '../../../../apps/web/src/lib/api-client';

vi.mock('../../../../apps/web/src/lib/api-client', () => ({ API_BASE_URL: 'https://api.example.test', fetchApi: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('profile avatar', () => {
  it('uses protected account-specific URLs and JSON upload contracts', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce({ version: null }).mockResolvedValueOnce({ version: 'a'.repeat(64) }).mockResolvedValueOnce({ success: true });
    await profileAvatarApi.get(); await profileAvatarApi.upload('AAAA'); await profileAvatarApi.remove();
    expect(fetchApi).toHaveBeenCalledWith('/api/v1/profile/avatar');
    expect(fetchApi).toHaveBeenCalledWith('/api/v1/profile/avatar', { method: 'PUT', body: '{"imageBase64":"AAAA"}' });
    expect(fetchApi).toHaveBeenCalledWith('/api/v1/profile/avatar', { method: 'DELETE' });
    expect(profileAvatarUrl('a/b', 'v&1')).toBe('https://api.example.test/api/v1/profile/avatar/a%2Fb?v=v%261');
  });
  it('rejects invalid server metadata instead of constructing an image URL', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce({ version: '<script>' });
    await expect(profileAvatarApi.get()).rejects.toThrow();
  });
  it.each(['image/svg+xml', 'text/html', ''])('rejects unsafe input type %s before opening it', async (type) => {
    await expect(encodeProfileAvatar(new File(['data'], 'photo', { type }))).rejects.toThrow('PNG, JPEG or WebP');
  });
  it('rejects empty and oversized files', async () => {
    await expect(encodeProfileAvatar(new File([], 'photo.png', { type: 'image/png' }))).rejects.toThrow('5 MB');
    await expect(encodeProfileAvatar(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' }))).rejects.toThrow('5 MB');
  });
  function mockImage(fail = false) {
    class MockImage {
      naturalWidth = 600; naturalHeight = 400;
      onload?: () => void; onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => fail ? this.onerror?.() : this.onload?.()); }
    }
    vi.stubGlobal('Image', MockImage);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:photo') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  }
  it('crops centrally to 256 pixels and uploads only normalized PNG bytes', async () => {
    mockImage();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AQID');
    expect(await encodeProfileAvatar(new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }))).toBe('AQID');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 0, 400, 400, 0, 0, 256, 256);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
  it('cleans up a failed image decode', async () => {
    mockImage(true);
    await expect(encodeProfileAvatar(new File(['broken'], 'photo.png', { type: 'image/png' }))).rejects.toThrow('could not be opened');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
  it('rejects oversized normalized output and releases its object URL', async () => {
    mockImage();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${'A'.repeat(400000)}`);
    await expect(encodeProfileAvatar(new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('too large');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
});
