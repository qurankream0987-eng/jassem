/**
 * Calculator Tool Adapter — Safe Mathematical Expression Evaluator
 *
 * Supports: arithmetic (+, -, *, /, %, ^, **), scientific functions,
 * constants (pi, e), unit conversions, and complex expressions.
 *
 * NEVER uses eval() or Function(). Implements a recursive descent parser.
 */

import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface CalculatorInputs {
  expression: string;
  precision?: number;
  mode?: "decimal" | "scientific";
}

export interface CalculatorOutput {
  result: number;
  expression: string;
  steps?: string[];
}

/**
 * Execute a safe mathematical expression evaluation.
 */
export async function executeCalculator(
  inputs: CalculatorInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();

  try {
    const expression = (inputs.expression || "").trim();
    if (!expression) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "Calculator requires an 'expression' string",
        "calculator"
      );
    }

    const precision = inputs.precision ?? 10;

    // Pre-process: handle unit conversion syntax like "5 km to miles"
    const unitConversion = parseUnitConversion(expression);
    if (unitConversion) {
      const converted = performUnitConversion(
        unitConversion.value,
        unitConversion.fromUnit,
        unitConversion.toUnit
      );
      return {
        success: true,
        output: {
          result: roundToPrecision(converted, precision),
          expression,
          steps: [`${unitConversion.value} ${unitConversion.fromUnit} = ${converted} ${unitConversion.toUnit}`],
        },
        duration: Date.now() - start,
        sideEffects: [],
      };
    }

    // Tokenize and parse
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    const result = parser.parse();

    if (Number.isNaN(result)) {
      throw new ToolError(
        ERROR_CODES.TOOL_INVOCATION_FAILED,
        "Calculation resulted in NaN",
        "calculator"
      );
    }

    if (!Number.isFinite(result)) {
      throw new ToolError(
        ERROR_CODES.TOOL_INVOCATION_FAILED,
        "Calculation resulted in Infinity",
        "calculator"
      );
    }

    return {
      success: true,
      output: {
        result: roundToPrecision(result, precision),
        expression,
      },
      duration: Date.now() - start,
      sideEffects: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

interface UnitConversionRequest {
  value: number;
  fromUnit: string;
  toUnit: string;
}

function parseUnitConversion(expr: string): UnitConversionRequest | null {
  const patterns = [
    /^([\d.]+)\s*(\w+)\s+(?:to|in|into)\s+(\w+)$/i,
    /^([\d.]+)\s*(\w+)\s*=\s*\?\s*(\w+)$/i,
    /^convert\s+([\d.]+)\s*(\w+)\s+(?:to|into)\s+(\w+)$/i,
  ];

  for (const pattern of patterns) {
    const match = expr.match(pattern);
    if (match) {
      return {
        value: Number.parseFloat(match[1]),
        fromUnit: match[2].toLowerCase(),
        toUnit: match[3].toLowerCase(),
      };
    }
  }
  return null;
}

const CONVERSION_FACTORS: Record<string, Record<string, number>> = {
  // Length
  km: { m: 1000, mi: 0.621371, ft: 3280.84, yd: 1093.61, cm: 100000, mm: 1000000, in: 39370.1 },
  m: { km: 0.001, mi: 0.000621371, ft: 3.28084, yd: 1.09361, cm: 100, mm: 1000, in: 39.3701 },
  cm: { m: 0.01, km: 0.00001, mm: 10, in: 0.393701, ft: 0.0328084 },
  mm: { m: 0.001, cm: 0.1, in: 0.0393701 },
  mi: { km: 1.60934, m: 1609.34, ft: 5280, yd: 1760 },
  ft: { m: 0.3048, km: 0.0003048, mi: 0.000189394, yd: 0.333333, in: 12 },
  yd: { m: 0.9144, ft: 3, mi: 0.000568182 },
  in: { cm: 2.54, mm: 25.4, ft: 0.0833333, m: 0.0254 },
  // Mass
  kg: { g: 1000, lb: 2.20462, oz: 35.274, t: 0.001 },
  g: { kg: 0.001, mg: 1000, lb: 0.00220462, oz: 0.035274 },
  mg: { g: 0.001, kg: 0.000001 },
  lb: { kg: 0.453592, g: 453.592, oz: 16 },
  oz: { g: 28.3495, kg: 0.0283495, lb: 0.0625 },
  t: { kg: 1000 },
  // Volume
  l: { ml: 1000, gal: 0.264172, qt: 1.05669, pt: 2.11338, cup: 4.22675 },
  ml: { l: 0.001 },
  gal: { l: 3.78541, qt: 4, pt: 8 },
  qt: { l: 0.946353, gal: 0.25, pt: 2 },
  pt: { l: 0.473176, qt: 0.5, gal: 0.125 },
  // Temperature
  c: { f: -999, k: -998 }, // special
  f: { c: -999, k: -998 }, // special
  k: { c: -999, f: -998 }, // special
  // Area
  m2: { km2: 0.000001, ft2: 10.7639, ac: 0.000247105, ha: 0.0001 },
  km2: { m2: 1000000, ha: 100, ac: 247.105 },
  ha: { m2: 10000, km2: 0.01, ac: 2.47105 },
  ac: { m2: 4046.86, ha: 0.404686, km2: 0.00404686 },
  ft2: { m2: 0.092903, ac: 0.0000229568 },
  // Speed
  kmh: { ms: 0.277778, mph: 0.621371, knots: 0.539957 },
  ms: { kmh: 3.6, mph: 2.23694, knots: 1.94384 },
  mph: { kmh: 1.60934, ms: 0.44704, knots: 0.868976 },
  knots: { kmh: 1.852, ms: 0.514444, mph: 1.15078 },
};

function performUnitConversion(value: number, fromUnit: string, toUnit: string): number {
  const normalizedFrom = normalizeUnit(fromUnit);
  const normalizedTo = normalizeUnit(toUnit);

  if (normalizedFrom === normalizedTo) return value;

  // Temperature conversions need special handling
  if (normalizedFrom === "c" && normalizedTo === "f") return (value * 9) / 5 + 32;
  if (normalizedFrom === "f" && normalizedTo === "c") return ((value - 32) * 5) / 9;
  if (normalizedFrom === "c" && normalizedTo === "k") return value + 273.15;
  if (normalizedFrom === "k" && normalizedTo === "c") return value - 273.15;
  if (normalizedFrom === "f" && normalizedTo === "k") return ((value - 32) * 5) / 9 + 273.15;
  if (normalizedFrom === "k" && normalizedTo === "f") return ((value - 273.15) * 9) / 5 + 32;

  const fromMap = CONVERSION_FACTORS[normalizedFrom];
  if (!fromMap) {
    throw new ToolError(
      ERROR_CODES.TOOL_INVOCATION_FAILED,
      `Unknown unit: ${fromUnit}`,
      "calculator"
    );
  }

  const factor = fromMap[normalizedTo];
  if (factor === undefined) {
    throw new ToolError(
      ERROR_CODES.TOOL_INVOCATION_FAILED,
      `Cannot convert from ${fromUnit} to ${toUnit}`,
      "calculator"
    );
  }

  return value * factor;
}

function normalizeUnit(unit: string): string {
  const map: Record<string, string> = {
    kilometers: "km", kilometer: "km", kms: "km",
    meters: "m", meter: "m",
    centimeters: "cm", centimeter: "cm", cms: "cm",
    millimeters: "mm", millimeter: "mm",
    miles: "mi", mile: "mi",
    feet: "ft", foot: "ft",
    yards: "yd", yard: "yd",
    inches: "in", inch: "in",
    kilograms: "kg", kilogram: "kg", kgs: "kg",
    grams: "g", gram: "g",
    milligrams: "mg", milligram: "mg",
    pounds: "lb", pound: "lb", lbs: "lb",
    ounces: "oz", ounce: "oz",
    tonnes: "t", ton: "t", tons: "t",
    liters: "l", liter: "l", litres: "l", litre: "l",
    milliliters: "ml", millilitre: "ml",
    gallons: "gal", gallon: "gal",
    quarts: "qt", quart: "qt",
    pints: "pt", pint: "pt",
    cups: "cup",
    celsius: "c", celcius: "c",
    fahrenheit: "f", farenheit: "f",
    kelvin: "k",
    squaremeters: "m2", sqm: "m2", "m²": "m2",
    squarekilometers: "km2", sqkm: "km2", "km²": "km2",
    hectares: "ha",
    acres: "ac", acre: "ac",
    squarefeet: "ft2", sqft: "ft2", "ft²": "ft2",
    kmh: "kmh", "km/h": "kmh",
    ms: "ms", "m/s": "ms",
    mph: "mph",
    knots: "knots", knot: "knots",
  };
  return map[unit.toLowerCase()] || unit.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECURSIVE DESCENT PARSER (No eval)
// ═══════════════════════════════════════════════════════════════════════════════

type TokenType =
  | "NUMBER"
  | "IDENTIFIER"
  | "PLUS"
  | "MINUS"
  | "MULTIPLY"
  | "DIVIDE"
  | "MODULO"
  | "POWER"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    const pos = i;

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Numbers (including decimals and scientific notation)
    if (/\d/.test(ch) || (ch === "." && /\d/.test(expr[i + 1] || ""))) {
      let num = "";
      while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === ".")) {
        num += expr[i++];
      }
      // Scientific notation
      if (i < expr.length && (expr[i] === "e" || expr[i] === "E")) {
        num += expr[i++];
        if (i < expr.length && (expr[i] === "+" || expr[i] === "-")) {
          num += expr[i++];
        }
        while (i < expr.length && /\d/.test(expr[i])) {
          num += expr[i++];
        }
      }
      tokens.push({ type: "NUMBER", value: num, pos });
      continue;
    }

    // Identifiers (functions and constants)
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        id += expr[i++];
      }
      tokens.push({ type: "IDENTIFIER", value: id, pos });
      continue;
    }

    // Operators
    switch (ch) {
      case "+":
        tokens.push({ type: "PLUS", value: ch, pos });
        i++;
        break;
      case "-":
        tokens.push({ type: "MINUS", value: ch, pos });
        i++;
        break;
      case "*":
        if (expr[i + 1] === "*") {
          tokens.push({ type: "POWER", value: "**", pos });
          i += 2;
        } else {
          tokens.push({ type: "MULTIPLY", value: ch, pos });
          i++;
        }
        break;
      case "^":
        tokens.push({ type: "POWER", value: "^", pos });
        i++;
        break;
      case "/":
        tokens.push({ type: "DIVIDE", value: ch, pos });
        i++;
        break;
      case "%":
        tokens.push({ type: "MODULO", value: ch, pos });
        i++;
        break;
      case "(":
        tokens.push({ type: "LPAREN", value: ch, pos });
        i++;
        break;
      case ")":
        tokens.push({ type: "RPAREN", value: ch, pos });
        i++;
        break;
      case ",":
        tokens.push({ type: "COMMA", value: ch, pos });
        i++;
        break;
      default:
        throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }
  }

  tokens.push({ type: "EOF", value: "", pos: expr.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: "EOF", value: "", pos: -1 };
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(
        `Expected ${type} but got ${token.type} at position ${token.pos}`
      );
    }
    this.pos++;
    return token;
  }

  parse(): number {
    const result = this.parseExpression();
    if (this.current().type !== "EOF") {
      throw new Error(
        `Unexpected token '${this.current().value}' at position ${this.current().pos}`
      );
    }
    return result;
  }

  // expression = term (("+" | "-") term)*
  private parseExpression(): number {
    let value = this.parseTerm();
    while (this.current().type === "PLUS" || this.current().type === "MINUS") {
      const op = this.advance();
      const right = this.parseTerm();
      if (op.type === "PLUS") value += right;
      else value -= right;
    }
    return value;
  }

  // term = factor (("*" | "/" | "%") factor)*
  private parseTerm(): number {
    let value = this.parseFactor();
    while (
      this.current().type === "MULTIPLY" ||
      this.current().type === "DIVIDE" ||
      this.current().type === "MODULO"
    ) {
      const op = this.advance();
      const right = this.parseFactor();
      if (op.type === "MULTIPLY") value *= right;
      else if (op.type === "DIVIDE") {
        if (right === 0) throw new Error("Division by zero");
        value /= right;
      } else {
        if (right === 0) throw new Error("Modulo by zero");
        value = value % right;
      }
    }
    return value;
  }

  // factor = power (("**" | "^") power)*
  private parseFactor(): number {
    let value = this.parsePower();
    while (this.current().type === "POWER") {
      this.advance();
      const right = this.parsePower();
      value = Math.pow(value, right);
    }
    return value;
  }

  // power = unary
  private parsePower(): number {
    return this.parseUnary();
  }

  // unary = ("+" | "-") unary | primary
  private parseUnary(): number {
    if (this.current().type === "MINUS") {
      this.advance();
      return -this.parseUnary();
    }
    if (this.current().type === "PLUS") {
      this.advance();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  // primary = number | identifier | identifier(" args ") | "(" expression ")"
  private parsePrimary(): number {
    const token = this.current();

    if (token.type === "NUMBER") {
      this.advance();
      return Number.parseFloat(token.value);
    }

    if (token.type === "IDENTIFIER") {
      this.advance();
      const name = token.value.toLowerCase();

      // Function call
      if (this.current().type === "LPAREN") {
        this.advance();
        const args: number[] = [];
        if (this.current().type !== "RPAREN") {
          args.push(this.parseExpression());
          while (this.current().type === "COMMA") {
            this.advance();
            args.push(this.parseExpression());
          }
        }
        this.expect("RPAREN");
        return evaluateFunction(name, args);
      }

      // Constant
      return evaluateConstant(name);
    }

    if (token.type === "LPAREN") {
      this.advance();
      const value = this.parseExpression();
      this.expect("RPAREN");
      return value;
    }

    throw new Error(
      `Unexpected token '${token.value}' at position ${token.pos}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function evaluateFunction(name: string, args: number[]): number {
  const unary = (fn: (x: number) => number, expectedArgs = 1): number => {
    if (args.length !== expectedArgs) {
      throw new Error(`${name}() expects ${expectedArgs} argument(s)`);
    }
    return fn(args[0]);
  };

  const binary = (fn: (a: number, b: number) => number): number => {
    if (args.length !== 2) {
      throw new Error(`${name}() expects 2 arguments`);
    }
    return fn(args[0], args[1]);
  };

  switch (name) {
    // Trigonometry (radians)
    case "sin": return unary(Math.sin);
    case "cos": return unary(Math.cos);
    case "tan": return unary(Math.tan);
    case "asin": return unary(Math.asin);
    case "acos": return unary(Math.acos);
    case "atan": return unary(Math.atan);
    case "atan2": return binary(Math.atan2);

    // Hyperbolic
    case "sinh": return unary(Math.sinh);
    case "cosh": return unary(Math.cosh);
    case "tanh": return unary(Math.tanh);

    // Logarithmic
    case "log": return unary(Math.log10);
    case "ln": return unary(Math.log);
    case "log2": return unary(Math.log2);

    // Exponential
    case "exp": return unary(Math.exp);

    // Roots
    case "sqrt": return unary(Math.sqrt);
    case "cbrt": return unary(Math.cbrt);

    // Rounding
    case "abs": return unary(Math.abs);
    case "ceil": return unary(Math.ceil);
    case "floor": return unary(Math.floor);
    case "round": return unary(Math.round);
    case "trunc": return unary(Math.trunc);

    // Min/Max
    case "min": return Math.min(...args);
    case "max": return Math.max(...args);

    // Powers
    case "pow": return binary(Math.pow);

    // Random
    case "random": return Math.random();

    // Constants (as functions for convenience)
    case "pi": return Math.PI;
    case "e": return Math.E;

    default:
      throw new Error(`Unknown function or constant: ${name}()`);
  }
}

function evaluateConstant(name: string): number {
  switch (name) {
    case "pi": return Math.PI;
    case "e": return Math.E;
    case "phi": return 1.618033988749895;
    default:
      throw new Error(`Unknown constant: ${name}`);
  }
}

function roundToPrecision(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}
