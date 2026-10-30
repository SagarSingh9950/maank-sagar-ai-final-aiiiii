const {
  listFolder,
  findFile,
  readFile,
  getFileInfo,
  openFolder,
  openFile,
} = require("./tools/fileManager.cjs");


const projectFolder =
  "D:\\personal-ai-desktop";


console.log("\n=== LIST PROJECT FOLDER ===");

const items = listFolder(projectFolder);

console.log(items);


console.log("\n=== FIND calculator.cjs ===");

const found = findFile(
  projectFolder,
  "calculator.cjs"
);

console.log(found);


console.log("\n=== FILE INFORMATION ===");

if (found.length > 0) {
  console.log(
    getFileInfo(found[0])
  );
}


console.log("\n=== READ calculator.cjs ===");

if (found.length > 0) {
  const content = readFile(found[0]);

  console.log(
    content.substring(0, 500)
  );
}


// Uncomment these when you want to test
// opening things in Windows.

// openFolder(projectFolder);

// if (found.length > 0) {
//   openFile(found[0]);
// }