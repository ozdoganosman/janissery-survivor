/**
 * The page the game runs in. On its own (GitHub Pages, a local build) a file is offered
 * with an ordinary download link; framed as a claude.ai artifact, links cannot download,
 * so the file goes through the host's `downloads` capability, which asks the viewer first.
 */

interface HostDownloads {
  save(request: { filename: string; data: string }): Promise<{ status: string }>;
}

interface Host {
  use(name: 'downloads'): Promise<HostDownloads | null>;
}

declare global {
  interface Window {
    /** Present only when the page is served inside the claude.ai artifact viewer. */
    claude?: Host;
  }
}

export type OfferResult = 'saved' | 'declined' | 'failed';

export async function offerFile(filename: string, text: string): Promise<OfferResult> {
  const host = window.claude;
  if (host !== undefined && typeof host.use === 'function') {
    const downloads = await host.use('downloads').catch(() => null);
    if (downloads !== null) {
      try {
        await downloads.save({ filename, data: text });
        return 'saved';
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        return code === 'declined' ? 'declined' : 'failed';
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'saved';
}
