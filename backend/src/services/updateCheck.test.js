import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./safeFetch.js', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from './safeFetch.js';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('UPDATE_CHECK_REPO', '');
  vi.stubEnv('UPDATE_CHECK_DISABLED', '');
});

async function status(latest, current, extra = {}) {
  safeFetch.mockResolvedValue({ ok: true, json: async () => ({ tag_name: latest, ...extra }) });
  const { getUpdateStatus } = await import('./updateCheck.js');
  return getUpdateStatus(current);
}

describe('custom server release checks', () => {
  it('uses the fork by default and discovers a custom patch on the same upstream version', async () => {
    const result = await status('v4.3.0-custom.2', '4.3.0-custom.1');
    expect(safeFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/YunQue0912/mailflow/releases/latest');
    expect(result).toMatchObject({ updateAvailable: true, latest: '4.3.0-custom.2', url: 'https://github.com/YunQue0912/mailflow/releases' });
  });

  it.each([
    ['v4.3.0-custom.1', '4.3.0-custom.1', false],
    ['v4.3.0-custom.1', '4.3.0-custom.2', false],
    ['v4.3.0-custom.10', '4.3.0-custom.9', true],
    ['v4.3.0-custom.1', '3.5.9-custom.99', true],
    ['v4.2.0-custom.99', '4.3.0-custom.1', false],
    ['v4.4.0', '4.3.0-custom.1', true],
  ])('compares %s against %s', async (latest, current, expected) => {
    expect((await status(latest, current)).updateAvailable).toBe(expected);
  });

  it.each([
    ['v4.3.1-custom.1', { draft: true }],
    ['v4.3.1-custom.1', { prerelease: true }],
    ['v4.3.1-beta.1', {}],
    ['v4.3.1-custom.2extra', {}],
  ])('ignores unpublished or invalid release %s', async (latest, extra) => {
    expect((await status(latest, '4.3.0-custom.1', extra)).updateAvailable).toBe(false);
  });

  it('retains an explicit upstream repository override', async () => {
    vi.stubEnv('UPDATE_CHECK_REPO', 'maathimself/mailflow');
    expect((await status('v4.4.0', '4.3.0-custom.1')).updateAvailable).toBe(true);
    expect(safeFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/maathimself/mailflow/releases/latest');
  });

  it('respects the disabled setting without contacting GitHub', async () => {
    vi.stubEnv('UPDATE_CHECK_DISABLED', 'true');
    expect(await status('v4.4.0-custom.1', '4.3.0-custom.1')).toMatchObject({ disabled: true, updateAvailable: false });
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
