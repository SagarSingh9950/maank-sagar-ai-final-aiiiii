require("dotenv").config();

const { webSearch } = require("./tools/webSearch.cjs");

async function test() {
  try {
    const results = await webSearch("latest technology news");

    console.log("Search successful!");
    console.log(results);
  } catch (error) {
    console.error("Search failed:");
    console.error(error);
  }
}

test();