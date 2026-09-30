import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBrowser } from './browser';

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })) }));

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('openBrowser', () => {
  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    vi.clearAllMocks();
  });

  it('hands the full URL to rundll32 on Windows, never to cmd', () => {
    setPlatform('win32');
    // Several query parameters, so more than one `&` - exactly what `cmd /c start` would cut.
    const url =
      'http://127.0.0.1:54321/callback?external_tool_token=abc&token_id=id-1'
      + '&acting_as=Alex+User&state=xyz';

    openBrowser(url);

    expect(spawn).toHaveBeenCalledWith(
      'rundll32',
      ['url.dll,FileProtocolHandler', url],
      expect.objectContaining({ stdio: 'ignore', detached: true }),
    );
    expect(spawn).not.toHaveBeenCalledWith('cmd', expect.anything(), expect.anything());
  });

  it('opens via `open` on macOS', () => {
    setPlatform('darwin');
    const url = 'http://127.0.0.1:54321/callback?state=xyz';

    openBrowser(url);

    expect(spawn).toHaveBeenCalledWith(
      'open',
      [url],
      expect.objectContaining({ stdio: 'ignore', detached: true }),
    );
  });

  it('opens via xdg-open elsewhere', () => {
    setPlatform('linux');
    const url = 'http://127.0.0.1:54321/callback?state=xyz';

    openBrowser(url);

    expect(spawn).toHaveBeenCalledWith(
      'xdg-open',
      [url],
      expect.objectContaining({ stdio: 'ignore', detached: true }),
    );
  });

  it('does not crash when the launcher is missing, and tells the user to open the URL', () => {
    setPlatform('linux');
    const url = 'http://127.0.0.1:54321/callback?state=xyz';
    const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
    emitter.unref = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce(emitter as never);
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    openBrowser(url);
    // Without a listener, emitting 'error' throws - exactly what killed the process before.
    expect(() =>
      emitter.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })),
    ).not.toThrow();

    const output = written.mock.calls.map((call) => String(call[0])).join('');
    written.mockRestore();
    expect(output).toContain('Open the URL printed above manually');
    expect(output).toContain(url);
  });
});
