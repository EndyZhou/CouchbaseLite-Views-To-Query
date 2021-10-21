import { parseSync, traverse } from "@babel/core";
import generate from "@babel/generator";
import * as t from "@babel/types";
import fs from "fs";

import { Constants, FILE } from "./Constants";
import { translate, genCallExpression, genFunction, getIfStatement, testByKeys } from "./helper";
import { RootViewMap } from "./Query/RootViewMap";

let RootQueryBuilderExports =  `
import { Query } from "${FILE.COUCHBASE_LIBRARY}";
import { ${FILE.BuilderName} } from "./${FILE.BuilderName}";

const ${FILE.RootQueryBuilder} = {} as Record<typeof ${FILE.BuilderName}[keyof typeof ${FILE.BuilderName}], (...args: any[]) =>Query>;\n
`;
let RootQueryBuilderImports = '';
export function generateQueryBuilder() {
  const BuilderName = {} as Record<string, string>;
  for (const [RootDir, Views] of Object.entries(RootViewMap)) {
    for (const [methodName, value] of Object.entries<{map: Function}>(Views)) {
      const referedIds = [
        Constants.Database,
        Constants.QueryBuilder,
        Constants.SelectResult,
        Constants.Meta,
        Constants.Expression,
        Constants.DataSource,
        Constants.Query,
      ];
      try {
        if (testByKeys(methodName)) continue;
        BuilderName[translate(methodName)] = methodName;

        const funcAst = parseSync("export default " + value.map) as t.File;
        traverse(funcAst, {
          FunctionDeclaration: function (path) {
            const { body, params } = path.node;
            const [DOC, _META] = params as t.Identifier[];
            const binding = path.scope.getBinding(DOC.name)!;
            const { emitFunc, whereParams, emitFuncScope } = getIfStatement(binding, body);
            // emit(key, value)
            const [, resValue] = emitFunc.expression.arguments;

            // selectResults: {[key]: alias}
            const selectResults: Record<string, string> = {};

            /* FIXME
             * const binding = path.scope.getBinding(name);
             * if (!binding || binding.constantViolations)
             * */
            // ignore (Mate.id, xxx.xx )
            if (t.isIdentifier(resValue) && resValue.name !== DOC.name) {
              const { name } = resValue;
              const { declarations } = ((emitFuncScope as t.BlockStatement).body.find((body) => {
                if (t.isVariableDeclaration(body) && body.declarations) {
                  return body.declarations.find((declaration) => t.isIdentifier(declaration.id, { name }));
                }
              }) || {}) as t.VariableDeclaration;
              // ignore let a = {}, b;
              const [declaration] = declarations;

              if (t.isObjectExpression(declaration.init)) {
                declaration.init.properties.forEach((propertie) => {
                  if (t.isObjectProperty(propertie)) {
                    switch (propertie.value.type) {
                      case "MemberExpression":
                        const { object, property } = propertie.value;
                        if (t.isIdentifier(object) && DOC.name === object.name) {
                          selectResults[(property as t.Identifier).name] = (
                            propertie.key as t.Identifier
                          ).name;
                        }
                        break;
                      case "Identifier":
                        const { name } = propertie.value;
                        if (["hasPic"].includes(name)) {
                          selectResults["_attachments"] = name;
                        }
                    }
                  }
                });
              }
            }

            const selectResultKeys = Object.keys(selectResults);
            const selectParamsByKey = selectResultKeys.length
              ? selectResultKeys.map((key) => {
                  const selectExpression = genCallExpression(key, Constants.property, Constants.SelectResult);
                  return key === selectResults[key]
                    ? selectExpression
                    : genCallExpression(selectResults[key], Constants.alias, selectExpression);
                })
              : [genCallExpression([], Constants.all, Constants.SelectResult)];

            const selectParams = [
              ...selectParamsByKey,
              genCallExpression(
                [t.identifier(Constants.META_ID)],
                Constants.expression,
                Constants.SelectResult
              ),
              genCallExpression(
                [t.identifier(Constants.META_IDSEQUENCE)],
                Constants.expression,
                Constants.SelectResult
              ),
            ];
            const select = genCallExpression(selectParams, Constants.select, Constants.QueryBuilder);

            const formParams = [
              genCallExpression(t.identifier(Constants.database), Constants.database, Constants.DataSource),
            ];
            const form = genCallExpression(formParams, Constants.form, select);

            // const whereParams = getWhereParams(binding, test);
            const where = genCallExpression([whereParams], Constants.where, form);

            const queryBuilder = t.identifier(Constants.QueryVariable);
            const builderVariable = t.variableDeclarator(queryBuilder, where);

            const returnStatement = t.returnStatement(queryBuilder);
            const builderStatement = t.variableDeclaration("const", [builderVariable]);
            const statement = [builderStatement, returnStatement];

            const func = genFunction(methodName, statement);
            // path.replaceWith(func);
            path.parentPath.replaceWith(t.exportNamedDeclaration(func));
            path.parentPath.shouldSkip = true;
          },
        });

        const newSpecifiers = referedIds.map((id) => t.importSpecifier(t.identifier(id), t.identifier(id)));
        const dbImportDeclaration = t.importDeclaration(
          newSpecifiers,
          t.stringLiteral(FILE.COUCHBASE_LIBRARY)
        );
        funcAst.program.body.unshift(dbImportDeclaration);

        const view = generate(funcAst, { auxiliaryCommentBefore: methodName });
        fs.writeFileSync(`./${FILE.RoorDir}/${RootDir}/${methodName}.ts`, view.code, { flag: "w" });

        fs.writeFileSync(`./${FILE.RoorDir}/${RootDir}/${methodName}.ts`, view.code, { flag: "w" });
        RootQueryBuilderImports += `import {${methodName}} from './${RootDir}/${methodName}';\n`
        RootQueryBuilderExports += `${FILE.RootQueryBuilder}[${FILE.BuilderName}.${translate(methodName)}] = ${methodName};\n`
      } catch (ex: any) {
        fs.appendFileSync(`./${FILE.RoorDir}/error.log`, `[${methodName}]:  ${ex.message}\n`);
      }
    }

    fs.writeFileSync(`./${FILE.RoorDir}/${FILE.BuilderName}.ts`, `export const ${FILE.BuilderName} = ${JSON.stringify(BuilderName)} as const`);
    fs.writeFileSync(`./${FILE.RoorDir}/${FILE.RootQueryBuilder}.ts`, `${RootQueryBuilderImports}${RootQueryBuilderExports}`);
  }
}
