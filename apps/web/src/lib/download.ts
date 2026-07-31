/**
 * Trigger a browser download for a fetched Blob (import templates, xlsx exports).
 * One place for the object-URL + temporary-anchor dance so every "Download
 * template" / export affordance behaves identically. Mirrors the inline logic the
 * student-import dialog used first (Phase 3).
 */
export function triggerBlobDownload(file: {
  blob: Blob;
  filename: string;
}): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
