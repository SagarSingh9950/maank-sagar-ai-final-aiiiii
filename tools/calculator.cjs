function calculate(expression) {
  if (typeof expression !== "string") {
    throw new Error("Expression must be a string.");
  }

  const input = expression
    .trim()
    .replace(/\s+/g, "");

  if (!input) {
    throw new Error("Expression is empty.");
  }

  const tokens = tokenize(input);
  const rpn = toRPN(tokens);
  const result = evaluateRPN(rpn);

  if (!Number.isFinite(result)) {
    throw new Error("Calculation produced an invalid result.");
  }

  return result;
}

/*
 * Convert the expression into tokens.
 *
 * Supported:
 * numbers
 * + - * / %
 * ^ exponent
 * ( )
 */
function tokenize(expression) {
  const tokens = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // Number
    if (/[0-9.]/.test(char)) {
      let number = "";
      let dots = 0;

      while (
        i < expression.length &&
        /[0-9.]/.test(expression[i])
      ) {
        if (expression[i] === ".") {
          dots++;
        }

        if (dots > 1) {
          throw new Error("Invalid number.");
        }

        number += expression[i];
        i++;
      }

      if (number === ".") {
        throw new Error("Invalid number.");
      }

      tokens.push({
        type: "number",
        value: Number(number),
      });

      continue;
    }

    // Operators
    if ("+-*/%^()".includes(char)) {
      tokens.push({
        type: char === "(" || char === ")" ? "paren" : "operator",
        value: char,
      });

      i++;
      continue;
    }

    throw new Error(
      `Unsupported character: "${char}"`
    );
  }

  return tokens;
}

/*
 * Convert tokens to Reverse Polish Notation
 * using the Shunting Yard algorithm.
 */
function toRPN(tokens) {
  const output = [];
  const operators = [];

  const precedence = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
    "%": 2,
    "^": 3,
    "u-": 4,
  };

  const rightAssociative = {
    "^": true,
    "u-": true,
  };

  let previous = null;

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
      previous = token;
      continue;
    }

    if (token.value === "(") {
      operators.push(token);
      previous = token;
      continue;
    }

    if (token.value === ")") {
      let foundOpeningParenthesis = false;

      while (operators.length > 0) {
        const top = operators.pop();

        if (top.value === "(") {
          foundOpeningParenthesis = true;
          break;
        }

        output.push(top);
      }

      if (!foundOpeningParenthesis) {
        throw new Error("Mismatched parentheses.");
      }

      previous = token;
      continue;
    }

    let operator = token.value;

    // Handle negative numbers / unary minus.
    if (
      operator === "-" &&
      (previous === null ||
        previous.value === "(" ||
        previous.type === "operator")
    ) {
      operator = "u-";
    }

    const current = {
      type: "operator",
      value: operator,
    };

    while (operators.length > 0) {
      const top = operators[operators.length - 1];

      if (
        top.type !== "operator" ||
        top.value === "("
      ) {
        break;
      }

      const currentPrecedence = precedence[operator];
      const topPrecedence = precedence[top.value];

      const shouldPop = rightAssociative[operator]
        ? currentPrecedence < topPrecedence
        : currentPrecedence <= topPrecedence;

      if (!shouldPop) {
        break;
      }

      output.push(operators.pop());
    }

    operators.push(current);
    previous = current;
  }

  while (operators.length > 0) {
    const operator = operators.pop();

    if (
      operator.value === "(" ||
      operator.value === ")"
    ) {
      throw new Error("Mismatched parentheses.");
    }

    output.push(operator);
  }

  return output;
}

/*
 * Evaluate Reverse Polish Notation.
 */
function evaluateRPN(tokens) {
  const stack = [];

  for (const token of tokens) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    if (token.value === "u-") {
      if (stack.length < 1) {
        throw new Error("Invalid expression.");
      }

      stack.push(-stack.pop());
      continue;
    }

    if (stack.length < 2) {
      throw new Error("Invalid expression.");
    }

    const b = stack.pop();
    const a = stack.pop();

    let result;

    switch (token.value) {
      case "+":
        result = a + b;
        break;

      case "-":
        result = a - b;
        break;

      case "*":
        result = a * b;
        break;

      case "/":
        if (b === 0) {
          throw new Error("Cannot divide by zero.");
        }

        result = a / b;
        break;

      case "%":
        if (b === 0) {
          throw new Error("Cannot divide by zero.");
        }

        result = a % b;
        break;

      case "^":
        result = Math.pow(a, b);
        break;

      default:
        throw new Error(
          `Unknown operator: ${token.value}`
        );
    }

    if (!Number.isFinite(result)) {
      throw new Error("Invalid calculation.");
    }

    stack.push(result);
  }

  if (stack.length !== 1) {
    throw new Error("Invalid expression.");
  }

  return stack[0];
}

module.exports = {
  calculate,
};