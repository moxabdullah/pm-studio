/// <reference path="../pb_data/types.d.ts" />

// Download names for uploaded files.
//
// PocketBase stores an upload as <name>_<10 random characters>.<ext> (report_a8d9s2k1b3.pdf) and, left alone, serves it under that name.
// People expect the name they uploaded, or the one they renamed it to. The app keeps that name in `doc.name` (renaming never touches the
// stored file), so when a file of the `files` collection is downloaded this sets the name of the download to it:
//
//   - the name is `doc.name`; when that is empty, missing or unreadable, PocketBase's own name is served as before,
//   - it always ends with the extension of the stored file: appended when the name lacks it (a file renamed "Final design" downloads
//     as "Final design.pdf"). A name with a different extension gets the real one added too, so "invoice.pdf" cannot hide an .exe,
//   - path separators become "_", control characters are dropped, quotes become apostrophes, and the name is cut at 200 characters.
//
// Only the original file is renamed. A thumbnail (?thumb=100x100) is served under PocketBase's own name for it, untouched.
//
// Header safety: PocketBase puts the name into `Content-Disposition: attachment; filename="..."` through strconv.Quote
// (tools/filesystem/filesystem.go, Serve), which escapes quotes, backslashes and control characters, so no name can break out of the
// header. Whether the file is shown inline or downloaded, and the Content-Security-Policy that sandboxes it, are decided by PocketBase
// and not touched here. (Verified on PocketBase 0.40.5: apis/file.go sets ServedName before this event, and Serve uses it.)
onFileDownloadRequest(e => {
  // Handlers run in isolated runtimes, so everything they use is defined inside them.
  const stored = e.record.getString('file');
  if (!stored || e.servedName !== stored) return e.next(); // a thumbnail

  let name = '';
  try {
    const doc = JSON.parse(e.record.getString('doc'));
    if (doc && typeof doc.name === 'string') name = doc.name;
  } catch {
    // an empty doc, or one that is not JSON: keep the stored name
  }
  name = Array.from(name)
    .filter(c => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
    .join('')
    .replace(/[\\/]/g, '_')
    .replace(/"/g, "'")
    .trim();
  if (!name) return e.next();

  const dot = stored.lastIndexOf('.');
  const ext = dot > 0 ? stored.slice(dot) : '';
  if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;

  // Cut by characters, not code units, so a pair of surrogates is never split. The extension stays.
  const max = 200;
  const chars = Array.from(name);
  if (chars.length > max) name = chars.slice(0, Math.max(1, max - Array.from(ext).length)).join('') + ext;

  e.servedName = name;
  return e.next();
}, 'files');
