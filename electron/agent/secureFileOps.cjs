const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BLOCKED_NAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'credentials.json', 'secrets.json', 'id_rsa', 'id_ed25519',
]);
const BLOCKED_EXTENSIONS = /\.(pem|key|p12|pfx)$/i;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.friday-proposals']);

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function isSensitive(target) {
  const parts = path.relative(path.parse(target).root, target).split(path.sep);
  return parts.some(part => BLOCKED_NAMES.has(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part) || BLOCKED_EXTENSIONS.test(part));
}
function resolveRoot(rootInput) {
  if (typeof rootInput !== 'string' || !rootInput.trim()) throw new Error('A project directory is required.');
  const root = fs.realpathSync(path.resolve(rootInput));
  if (!fs.statSync(root).isDirectory()) throw new Error('The project path must be a directory.');
  return root;
}
function resolveInside(root, relative, { allowMissing = false } = {}) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Only non-empty relative paths are allowed.');
  const target = path.resolve(root, relative);
  if (!isInside(root, target) || target === root) throw new Error('Path escapes the selected project directory.');
  if (isSensitive(target)) throw new Error('Sensitive paths are blocked from file operations.');
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stats = fs.lstatSync(cursor);
    if (stats.isSymbolicLink()) throw new Error('Symbolic links are not allowed in file operations.');
  }
  if (!allowMissing && !fs.existsSync(target)) throw new Error(`Source does not exist: ${relative}`);
  if (fs.existsSync(target) && !isInside(root, fs.realpathSync(target))) throw new Error('Resolved path escapes the selected project directory.');
  return target;
}
function fileFingerprint(filePath) {
  const stats = fs.statSync(filePath);
  // Avoid hashing arbitrarily large files just to propose a move.
  if (stats.size > 50 * 1024 * 1024) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function categoryFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico'].includes(ext)) return 'images';
  if (['.pdf','.doc','.docx','.txt','.md','.rtf','.ppt','.pptx','.xls','.xlsx','.csv'].includes(ext)) return 'documents';
  if (['.js','.jsx','.ts','.tsx','.py','.java','.c','.cpp','.h','.css','.html','.json','.yml','.yaml','.toml','.sql','.sh','.go','.rs'].includes(ext)) return 'source';
  if (['.zip','.7z','.rar','.tar','.gz'].includes(ext)) return 'archives';
  return 'other';
}
function buildOrganizationPlan(rootInput, options = {}) {
  const root = resolveRoot(rootInput);
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || 100, 500));
  const moves = [];
  function visit(dir, depth) {
    if (depth > 8 || moves.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (moves.length >= maxFiles) break;
      if (entry.isSymbolicLink() || (entry.isDirectory() && IGNORED_DIRS.has(entry.name.toLowerCase()))) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(abs, depth + 1); continue; }
      if (!entry.isFile() || isSensitive(abs)) continue;
      const rel = path.relative(root, abs);
      const parent = path.dirname(rel);
      // Keep already organized files and files in root-level ignored/project-specific folders in place.
      if (parent !== '.' || ['package.json','package-lock.json','readme.md','license'].includes(entry.name.toLowerCase())) continue;
      const stats = fs.statSync(abs);
      if (stats.size > 50 * 1024 * 1024) continue;
      const folder = categoryFor(entry.name);
      const destination = path.posix.join(folder, entry.name);
      if (fs.existsSync(path.join(root, destination))) continue;
      moves.push({ from: rel.split(path.sep).join('/'), to: destination, reason: `Group ${folder} files together`, sourceHash: fileFingerprint(abs) });
    }
  }
  visit(root, 0);
  return { root, moves, summary: `${moves.length} proposed move(s). No files have been changed.` };
}
function applyApprovedMoves(rootInput, moves) {
  const root = resolveRoot(rootInput);
  if (!Array.isArray(moves) || moves.length === 0) throw new Error('There are no proposed moves to apply.');
  if (moves.length > 100) throw new Error('A single approved operation is limited to 100 moves.');
  const prepared = moves.map((move, index) => {
    if (!move || typeof move.from !== 'string' || typeof move.to !== 'string') throw new Error(`Invalid move at index ${index}.`);
    const source = resolveInside(root, move.from, { allowMissing: true });
    const destination = resolveInside(root, move.to, { allowMissing: true });
    const sourceExists = fs.existsSync(source);
    const destinationExists = fs.existsSync(destination);
    if (sourceExists && !fs.lstatSync(source).isFile()) throw new Error(`Only regular files can be moved: ${move.from}`);
    if (sourceExists && destinationExists) throw new Error(`Destination already exists; refusing to overwrite: ${move.to}`);
    if (!sourceExists && destinationExists && typeof move.sourceHash === 'string' && fileFingerprint(destination) === move.sourceHash) {
      return { source, destination, from: move.from, to: move.to, alreadyApplied: true };
    }
    if (!sourceExists) throw new Error(`Source is missing and destination cannot be verified as a prior move: ${move.from}`);
    if (source === destination) throw new Error('Source and destination are identical.');
    if (typeof move.sourceHash === 'string' && fileFingerprint(source) !== move.sourceHash) {
      throw new Error(`Source changed after the preview was created: ${move.from}. Rebuild and review the plan.`);
    }
    return { source, destination, from: move.from, to: move.to, alreadyApplied: false };
  });
  const destinations = new Set();
  const sources = new Set();
  for (const item of prepared) {
    const sourceKey = process.platform === 'win32' ? item.source.toLowerCase() : item.source;
    if (sources.has(sourceKey)) throw new Error(`Duplicate source in plan: ${item.from}`);
    sources.add(sourceKey);
    const key = process.platform === 'win32' ? item.destination.toLowerCase() : item.destination;
    if (destinations.has(key)) throw new Error(`Duplicate destination in plan: ${item.to}`);
    destinations.add(key);
  }
  const createdDirs = new Set();
  const completed = [];
  try {
    for (const item of prepared) {
      if (item.alreadyApplied) continue;
      const parent = path.dirname(item.destination);
      const missing = [];
      let cursor = parent;
      while (isInside(root, cursor) && cursor !== root && !fs.existsSync(cursor)) {
        missing.push(cursor); cursor = path.dirname(cursor);
      }
      fs.mkdirSync(parent, { recursive: true });
      for (const dir of missing) createdDirs.add(dir);
      if (fs.existsSync(item.destination)) throw new Error(`Destination appeared during operation: ${item.to}`);
      fs.renameSync(item.source, item.destination);
      completed.push(item);
    }
  } catch (error) {
    for (const item of completed.reverse()) {
      try { fs.renameSync(item.destination, item.source); } catch (rollbackError) {
        error.message += ` Rollback warning for ${item.from}: ${rollbackError.message}`;
      }
    }
    for (const dir of [...createdDirs].sort((a,b) => b.length-a.length)) {
      try { fs.rmdirSync(dir); } catch { /* Keep non-empty directories. */ }
    }
    throw error;
  }
  const alreadyMoved = prepared.filter(item => item.alreadyApplied).map(({from,to}) => ({from,to}));
  const moved = completed.map(({from,to}) => ({from,to}));
  return { success: true, movedCount: moved.length + alreadyMoved.length, newlyMovedCount: moved.length, alreadyMovedCount: alreadyMoved.length, moves: [...alreadyMoved, ...moved] };
}

module.exports = { resolveRoot, resolveInside, isSensitive, IGNORED_DIRS, buildOrganizationPlan, applyApprovedMoves };
