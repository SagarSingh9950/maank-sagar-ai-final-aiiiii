const { calculate } = require("./tools/calculator.cjs");

console.log("Calculator tool test:\n");

const tests = [
  "25 * 48",
  "100 / 4",
  "(10 + 5) * 2",
  "2 ^ 10",
  "100 % 30",
  "-25 + 10",
  "10 + 5 * 2",
  "(10 + 5) * (20 - 8)",
  "2 ^ 3 ^ 2",
];

for (const expression of tests) {
  try {
    console.log(
      `${expression} = ${calculate(expression)}`
    );
  } catch (error) {
    console.log(
      `${expression} → ERROR: ${error.message}`
    );
  }
}