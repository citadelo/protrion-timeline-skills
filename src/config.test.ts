import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_ROOT, readConfig } from './config';

describe('readConfig', () => {
  it('roots the default credential store in the pack, not the working directory', () => {
    // Skills run while the agent stands in some other project. A cwd-relative default would write
    // credentials into that project - the exact thing the store exists to prevent.
    const config = readConfig({} as NodeJS.ProcessEnv);

    expect(path.isAbsolute(config.credentialsDir)).toBe(true);
    expect(config.credentialsDir).toBe(path.join(PACK_ROOT, '.credentials'));
    expect(PACK_ROOT.endsWith('protrion-timeline-skills')).toBe(true);
  });

  it('keeps the override for tests', () => {
    const config = readConfig({ TIMELINE_CREDENTIALS_DIR: '/tmp/elsewhere' } as NodeJS.ProcessEnv);

    expect(config.credentialsDir).toBe('/tmp/elsewhere');
  });

  it('refuses a plain http:// backend on a remote host', () => {
    // Every credential this pack holds would cross that network in the clear on every request.
    expect(() => readConfig({ TIMELINE_API_URL: 'http://timeline.example.com' } as NodeJS.ProcessEnv))
      .toThrow(/http:\/\//);
  });

  it('accepts a plain http:// backend on a loopback host', () => {
    expect(readConfig({ TIMELINE_API_URL: 'http://127.0.0.1:8080' } as NodeJS.ProcessEnv).apiUrl)
      .toBe('http://127.0.0.1:8080');
    expect(readConfig({ TIMELINE_API_URL: 'http://localhost:8080' } as NodeJS.ProcessEnv).apiUrl)
      .toBe('http://localhost:8080');
    expect(readConfig({ TIMELINE_API_URL: 'http://[::1]:8080' } as NodeJS.ProcessEnv).apiUrl)
      .toBe('http://[::1]:8080');
  });

  it('never restricts https://, whatever the host', () => {
    const config = readConfig(
      { TIMELINE_API_URL: 'https://timeline.example.com' } as NodeJS.ProcessEnv,
    );

    expect(config.apiUrl).toBe('https://timeline.example.com');
  });
});
