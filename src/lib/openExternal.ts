// Open an external link (a LinkedIn profile, a WhatsApp chat). In the sealed Freehold app the iframe
// has NO allow-popups, so a plain <a target="_blank"> is silently blocked by the browser — the link
// looks dead. The host exposes an `openExternal` broker capability that opens the link from the parent
// after validating + stripping it; route through that when we're sealed. In dev / unsealed there's no
// window.freehold, so fall back to a normal new-tab open.
type FreeholdApi = { request?: (cap: string, method: string, args: unknown) => Promise<unknown> };

export function openExternalLink(url: string | undefined): void {
  if (!url) return;
  const fh = (window as unknown as { freehold?: FreeholdApi }).freehold;
  if (fh?.request) {
    void fh.request("openExternal", "open", { url }).catch(() => {/* host refused / blocked */});
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
