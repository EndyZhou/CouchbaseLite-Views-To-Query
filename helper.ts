import * as t from "@babel/types";
import { Constants } from "./Constants";
import { Binding } from "@babel/traverse";
import { Utils } from "./utils";

const Operators = {
  "==": "equalTo",
  "===": "equalTo",
  "&&": "and",
  "||": "or",
  "!==": "notEqualTo",
  "!=": "notEqualTo",
  ">=": "greaterThanOrEqualTo",
  ">": "greaterThan ",
  "<=": "lessThanOrEqualTo",
  "<": "lessThan ",
  "??": "",
  notNullOrMissing: "notNullOrMissing",
  indexOf: "like",
} as const;

export function translate(str: string): string {
  return str.replace(/([A-Z])/g, (match) => `_${match}`).toUpperCase();
}

const testkeys = ["getAllAgentCode"];
export const testByKeys = (methodName: string) => {
  // return !testkeys.includes(methodName);
  return false;
};
export type NoUndefinedField<T> = T extends (infer P)[] ? (P extends undefined | null ? never : P[]) : never;

export const genCallExpression = (
  args:
    | (t.StringLiteral | t.Identifier | t.CallExpression | undefined)[]
    | string
    | t.StringLiteral
    | t.Identifier,
  property = Constants.property,
  method: string | t.CallExpression = Constants.Expression
) => {
  const _property = Utils.isString(property) ? t.identifier(property) : property;
  const _object = Utils.isString(method) ? t.identifier(method) : method;
  const _callee = t.memberExpression(_object, _property);
  const _arguments = Utils.isArray(args)
    ? args.filter((arg) => arg)
    : Utils.isString(args)
    ? [t.stringLiteral(args)]
    : [args];
  return t.callExpression(_callee, _arguments as NoUndefinedField<typeof _arguments>);
};

const genTypeAnnotation = (property: string) => {
  return t.typeAnnotation(t.genericTypeAnnotation(t.identifier(property)));
};

// emit func
export function getEmitFunc(consequent: t.Statement) {
  const statement = t.isBlockStatement(consequent) ? consequent.body : [consequent];
  return statement.find(
    (node) =>
      t.isExpressionStatement(node) &&
      t.isCallExpression(node.expression) &&
      t.isIdentifier(node.expression.callee, { name: "emit" })
  );
}

export const genFunction = (methodName: string, statement: Array<t.Statement>, args = []) => {
  const database = t.identifier(Constants.database);
  database.typeAnnotation = genTypeAnnotation(Constants.Database);

  const _arguments = args.map((arg) => {
    return t.objectProperty(t.identifier(arg), t.identifier(arg));
  });
  const _params = _arguments.length ? [database, t.objectPattern(_arguments)] : [database];
  const _statement = Utils.isArray<t.Statement>(statement) ? statement : [statement];
  const _body = t.blockStatement(_statement);
  const _id = t.identifier(methodName);
  const functionExpression = t.functionDeclaration(_id, _params, _body);
  functionExpression.returnType = genTypeAnnotation(Constants.Query);
  return functionExpression;
};
const getMemberValue = (memberExpression: t.MemberExpression) => {
  const { property } = memberExpression;
  if (t.isIdentifier(property)) {
    return property.name;
  }
  if (t.isStringLiteral(property)) {
    return property.value;
  }
};

// @ts-ignore
export function getIfStatement(binding: Binding, statement: t.Statement, _whereParams?: t.CallExpression) {
  switch (statement.type) {
    case "BlockStatement": {
      // BUG
      const [node] = statement.body.filter((node) => node.type === "IfStatement");
      return getIfStatement(binding, node);
    }
    case "IfStatement": {
      const { test, consequent } = statement;
      const agreement = getWhereParams(binding, test);
      const whereParams = _whereParams
        ? genCallExpression([_whereParams], Constants.and, agreement)
        : agreement;
      const emitFunc = getEmitFunc(consequent);
      if (emitFunc) {
        return {
          emitFunc,
          whereParams,
          emitFuncScope: consequent,
        };
      }
      return getIfStatement(binding, consequent, whereParams);
    }
  }
}

export const getWhereParams = (binding: Binding, test: t.Expression): t.CallExpression | undefined => {
  switch (test.type) {
    case "MemberExpression": {
      // default doc.xxx
      const parentExpression = genCallExpression(getMemberValue(test)!);
      return genCallExpression([], Operators.notNullOrMissing, parentExpression);
    }
    case "LogicalExpression": {
      const { left, right, operator } = test;

      const leftExpression = getWhereParams(binding, left);

      const rightExpression = getWhereParams(binding, right);

      return genCallExpression([rightExpression], Operators[operator], leftExpression);
    }
    case "BinaryExpression": {
      const { right, left } = test;
      const { type: leftType } = left;
      let operator = test.operator as keyof typeof Operators;
      let condition, leftKey, _arguments;
      switch (leftType) {
        case "CallExpression": {
          const { callee } = left;
          condition = binding.referencePaths.find((node) => {
            return node.parent === (callee as t.MemberExpression).object;
          });
          operator = getMemberValue(callee as t.MemberExpression) as keyof typeof Operators;
          break;
        }
        case "MemberExpression": {
          condition = binding.referencePaths.find((node) => {
            return node.parent === test.left;
          });
          break;
        }
      }

      if (t.isExpression(condition)) {
        leftKey = getMemberValue(condition.parent as t.MemberExpression)!;
        switch (right.type) {
          case "Identifier": {
            if (["null", "undefined"].includes(right.name)) {
              operator = Operators.notNullOrMissing;
            } else {
              _arguments = genCallExpression(right.name);
            }
            break;
          }
          case "StringLiteral": {
            if (["null", "undefined"].includes(right.value)) {
              operator = Operators.notNullOrMissing;
            } else {
              _arguments = genCallExpression(right.value, Constants.string);
            }
            break;
          }
          case "UnaryExpression": {
            if (operator === Constants.indexOf) {
              // default test.operator !== - 1
              // @ts-ignore
              _arguments = genCallExpression(getMemberValue(left.arguments[0]));
            }
          }
          case "NullLiteral": {
            operator = Operators.notNullOrMissing;
          }
        }
        const _condition = genCallExpression(leftKey, Constants.property, Constants.Expression);
        return genCallExpression([_arguments], Operators[operator], _condition);
      }
    }
  }
};
