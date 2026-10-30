const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const secureFileOps = require("../../electron/agent/secureFileOps.cjs");

const PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_PLANS = 100;
const MAX_COPY_FILES = 5000;
const MAX_COPY_BYTES = 250 * 1024 * 1024;
const plans = new Map();
const ignoredDirectories = secureFileOps.IGNORED_DIRS;

function assertNoSymlink(target, label) {
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link.`);
}

function validateProjectDirectory(input) {
  if (typeof input !== "string" || !input.trim() || !path.isAbsolute(input)) {
    throw new Error("Enter an absolute project folder path.");
  }
  const requestedPath = path.resolve(input);
  assertNoSymlink(requestedPath, "Project folder");
  const root = secureFileOps.resolveRoot(requestedPath);
  if (secureFileOps.isSensitive(root)) throw new Error("Sensitive project paths are blocked.");
  return root;
}

function validateExistingDirectory(input, label) {
  if (typeof input !== "string" || !input.trim() || !path.isAbsolute(input)) {
    throw new Error(`${label} must be an absolute folder path.`);
  }
  const requestedPath = path.resolve(input);
  const stats = fs.lstatSync(requestedPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} must be a regular directory, not a symbolic link.`);
  const resolvedPath = fs.realpathSync(requestedPath);
  if (secureFileOps.isSensitive(resolvedPath)) throw new Error(`${label} cannot be a sensitive path.`);
  return resolvedPath;
}

function pathKey(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveRenameTarget(root, destination) {
  if (typeof destination !== "string" || !destination.trim()) {
    throw new Error("Enter the new project folder name.");
  }
  const value = destination.trim();
  let target;
  if (path.isAbsolute(value)) {
    target = path.resolve(value);
  } else {
    if (value === "." || value === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)) {
      throw new Error("Enter a valid folder name without a path or Windows-reserved characters.");
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
      throw new Error("That folder name is reserved by Windows.");
    }
    target = path.join(path.dirname(root), value);
  }
  if (pathKey(path.dirname(target)) !== pathKey(path.dirname(root))) {
    throw new Error("Renaming must keep the project in its current parent folder. Use Move project to change folders.");
  }
  if (pathKey(target) === pathKey(root)) throw new Error("Enter a different folder name.");
  if (secureFileOps.isSensitive(target)) throw new Error("Sensitive destination paths are blocked.");
  if (fs.existsSync(target)) throw new Error("A file or folder already exists at the requested destination.");
  return target;
}

function collectCopyFiles(root) {
  const files = [];
  let totalBytes = 0;
  let skippedSymlinks = 0;

  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = path.join(directory, entry.name);
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name.toLowerCase()) || secureFileOps.isSensitive(source)) continue;
        visit(source, relativePath);
        continue;
      }
      if (!entry.isFile() || secureFileOps.isSensitive(source)) continue;
      const stats = fs.statSync(source);
      totalBytes += stats.size;
      files.push({
        relativePath,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
      });
      if (files.length > MAX_COPY_FILES) throw new Error(`Copy is limited to ${MAX_COPY_FILES} files.`);
      if (totalBytes > MAX_COPY_BYTES) throw new Error("Copy is limited to 250 MB.");
    }
  }

  visit(root, "");
  return { files, totalBytes, skippedSymlinks };
}

function buildPlan(operation, projectPath, destination) {
  const root = validateProjectDirectory(projectPath);

  if (operation === "create") {
    const target = secureFileOps.resolveInside(root, destination, { allowMissing: true });
    const parent = path.dirname(target);
    if (!fs.statSync(parent).isDirectory()) throw new Error("The parent folder for the new folder must already exist.");
    if (fs.existsSync(target)) throw new Error("A file or folder already exists at the requested path.");
    return {
      operation,
      root,
      target,
      relativeTarget: path.relative(root, target),
      description: `Create folder "${path.relative(root, target)}"`,
      details: [`Project: ${root}`, `New folder: ${target}`],
    };
  }

  if (operation === "rename") {
    const target = resolveRenameTarget(root, destination);
    return {
      operation,
      root,
      target,
      description: `Rename "${path.basename(root)}" to "${path.basename(target)}"`,
      details: [`Source: ${root}`, `Target: ${target}`],
    };
  }

  if (operation === "move" || operation === "copy") {
    const destinationDirectory = validateExistingDirectory(destination, "Destination");
    const target = path.join(destinationDirectory, path.basename(root));
    if (pathKey(target) === pathKey(root)) throw new Error("The destination is already the project’s current parent folder.");
    if (isInside(root, destinationDirectory)) throw new Error(`A project cannot be ${operation === "move" ? "moved" : "copied"} inside itself.`);
    if (fs.existsSync(target)) throw new Error("A folder with the project name already exists at the destination.");
    const plan = {
      operation,
      root,
      destinationDirectory,
      target,
      description: `${operation === "move" ? "Move" : "Copy"} "${path.basename(root)}"`,
      details: [`Source: ${root}`, `Target: ${target}`],
    };
    if (operation === "copy") {
      const snapshot = collectCopyFiles(root);
      plan.files = snapshot.files;
      plan.totalBytes = snapshot.totalBytes;
      plan.skippedSymlinks = snapshot.skippedSymlinks;
      plan.details.push(`${snapshot.files.length} file(s), ${snapshot.totalBytes} bytes will be copied; sensitive files and generated folders are excluded.`);
      if (snapshot.skippedSymlinks) plan.details.push(`${snapshot.skippedSymlinks} symbolic link(s) will be skipped.`);
    }
    return plan;
  }

  throw new Error("Choose a supported operation.");
}

function prunePlans() {
  const now = Date.now();
  for (const [token, plan] of plans) {
    if (plan.expiresAt <= now) plans.delete(token);
  }
  while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
}

function previewOperation({ operation, projectPath, destination }) {
  const plan = buildPlan(operation, projectPath, destination);
  prunePlans();
  const token = crypto.randomBytes(24).toString("hex");
  plan.expiresAt = Date.now() + PLAN_TTL_MS;
  plans.set(token, plan);
  return {
    token,
    operation: plan.operation,
    description: plan.description,
    details: plan.details,
    expiresAt: new Date(plan.expiresAt).toISOString(),
  };
}

function copyProject(plan) {
  const snapshot = collectCopyFiles(plan.root);
  if (JSON.stringify(snapshot.files) !== JSON.stringify(plan.files)) {
    throw new Error("Project files changed after the preview. Create a new preview and review it again.");
  }
  if (fs.existsSync(plan.target)) throw new Error("The destination appeared after the preview; no files were overwritten.");

  const createdDirectories = [plan.target];
  const createdFiles = [];
  try {
    fs.mkdirSync(plan.target);
    for (const file of plan.files) {
      const source = path.join(plan.root, file.relativePath);
      const target = path.join(plan.target, file.relativePath);
      const parent = path.dirname(target);
      const missing = [];
      let cursor = parent;
      while (cursor !== plan.target && !fs.existsSync(cursor)) {
        missing.push(cursor);
        cursor = path.dirname(cursor);
      }
      for (const directory of missing.reverse()) {
        fs.mkdirSync(directory);
        createdDirectories.push(directory);
      }
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      createdFiles.push(target);
    }
  } catch (error) {
    for (const file of createdFiles.reverse()) {
      try { fs.unlinkSync(file); } catch (rollbackError) {
        error.message += ` Cleanup warning for ${file}: ${rollbackError.message}`;
      }
    }
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch (rollbackError) {
        if (rollbackError.code !== "ENOTEMPTY" && rollbackError.code !== "ENOENT") {
          error.message += ` Cleanup warning for ${directory}: ${rollbackError.message}`;
        }
      }
    }
    throw error;
  }
  return { copiedCount: plan.files.length };
}

function executeOperation(token) {
  if (typeof token !== "string" || !token) throw new Error("A valid operation preview is required.");
  const plan = plans.get(token);
  if (!plan || plan.expiresAt <= Date.now()) {
    plans.delete(token);
    const error = new Error("This preview expired or was already used. Create a new preview.");
    error.status = 410;
    throw error;
  }
  plans.delete(token);

  if (plan.operation === "create") {
    const root = validateProjectDirectory(plan.root);
    const target = secureFileOps.resolveInside(root, plan.relativeTarget, { allowMissing: true });
    if (pathKey(target) !== pathKey(plan.target)) throw new Error("The project path changed after the preview. Create a new preview.");
    if (fs.existsSync(target)) throw new Error("The destination appeared after the preview; no folder was created.");
    fs.mkdirSync(target);
    return { success: true, message: `Created folder: ${target}` };
  }
  if (plan.operation === "rename" || plan.operation === "move") {
    const root = validateProjectDirectory(plan.root);
    const target = plan.operation === "move"
      ? path.join(validateExistingDirectory(plan.destinationDirectory, "Destination"), path.basename(root))
      : path.join(validateExistingDirectory(path.dirname(plan.target), "Project parent folder"), path.basename(plan.target));
    if (pathKey(root) !== pathKey(plan.root) || pathKey(target) !== pathKey(plan.target)) {
      throw new Error("The project paths changed after the preview. Create a new preview.");
    }
    if (fs.existsSync(target)) throw new Error("The destination appeared after the preview; no files were overwritten.");
    fs.renameSync(root, target);
    return { success: true, message: `Project ${plan.operation === "rename" ? "renamed" : "moved"} to: ${target}` };
  }
  if (plan.operation === "copy") {
    const root = validateProjectDirectory(plan.root);
    const destinationDirectory = validateExistingDirectory(plan.destinationDirectory, "Destination");
    if (pathKey(root) !== pathKey(plan.root) || pathKey(path.join(destinationDirectory, path.basename(root))) !== pathKey(plan.target)) {
      throw new Error("The project paths changed after the preview. Create a new preview.");
    }
    const result = copyProject(plan);
    return { success: true, message: `Copied ${result.copiedCount} file(s) to: ${plan.target}` };
  }
  throw new Error("The operation preview is invalid.");
}

module.exports = { previewOperation, executeOperation };
