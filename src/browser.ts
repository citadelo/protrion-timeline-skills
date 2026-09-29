import { spawn } from 'node:child_process';

/**
 * Opens a URL in the platform's default browser, in a process left to outlive this one.
 *
 * Windows deliberately does not go through `cmd /c start`: cmd.exe's own command-line parser
 * treats an unquoted `&` as a command separator, and a URL carrying more than one query
 * parameter has one - `cmd` would cut everything after the first `&` off the URL rather than
 * pass it through. `rundll32` hands the whole string straight to the URL protocol handler; it is
 * not a shell, so nothing in the URL is special to it.
 */
export function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  process.stderr.write(`Opened ${url}\nApprove it there, then come back.\n`);
}
