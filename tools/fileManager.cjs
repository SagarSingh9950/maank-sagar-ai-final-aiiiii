
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");


function listFolder(folderPath) {
  const resolvedPath = path.resolve(folderPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Folder does not exist.");
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new Error("The provided path is not a folder.");
  }

  const items = fs.readdirSync(resolvedPath, {
    withFileTypes: true,
  });

  return items.map((item) => ({
    name: item.name,
    type: item.isDirectory() ? "folder" : "file",
    path: path.join(resolvedPath, item.name),
  }));
}


function findFile(folderPath, fileName) {
  const resolvedPath = path.resolve(folderPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Folder does not exist.");
  }

  const results = [];

  function search(currentPath) {
    const items = fs.readdirSync(currentPath, {
      withFileTypes: true,
    });

    for (const item of items) {
      const itemPath = path.join(currentPath, item.name);

      if (
        item.isFile() &&
        item.name.toLowerCase() === fileName.toLowerCase()
      ) {
        results.push(itemPath);
      }

      if (item.isDirectory()) {
        search(itemPath);
      }
    }
  }

  search(resolvedPath);

  return results;
}


function readFile(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("File does not exist.");
  }

  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error("The provided path is not a file.");
  }

  return fs.readFileSync(resolvedPath, "utf8");
}


function getFileInfo(targetPath) {
  if (Array.isArray(targetPath)) {
    return targetPath.map((filePath) => getFileInfo(filePath));
  }

  const resolvedPath = path.resolve(targetPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Path does not exist: " + resolvedPath);
  }

  const stats = fs.statSync(resolvedPath);

  return {
    name: path.basename(resolvedPath),
    path: resolvedPath,
    type: stats.isDirectory() ? "folder" : "file",
    sizeBytes: stats.isFile() ? stats.size : null,
    created: stats.birthtime,
    modified: stats.mtime,
  };
}


function openFolder(folderPath) {
  const resolvedPath = path.resolve(folderPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Folder does not exist.");
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new Error("The provided path is not a folder.");
  }

  exec(`explorer "${resolvedPath}"`);

  return {
    success: true,
    path: resolvedPath,
  };
}


function openFile(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("File does not exist.");
  }

  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error("The provided path is not a file.");
  }

  exec(`start "" "${resolvedPath}"`, {
    shell: true,
  });

  return {
    success: true,
    path: resolvedPath,
  };
}


module.exports = {
  listFolder,
  findFile,
  readFile,
  getFileInfo,
  openFolder,
  openFile,
};
