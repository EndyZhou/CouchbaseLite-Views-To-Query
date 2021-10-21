import fs from "fs";
import { join } from "path";
let imps = "";
let type = "\ntype ViewTypes = {\n";
let exps = "\nconst RootViewMap = {} as ViewTypes;\n";
function genViewMaps() {
  fs.rmdirSync("./Query", { recursive: true });
  fs.mkdirSync("./Query");
  if (fs.existsSync("./views")) {
    const filesnames = fs.readdirSync("./views");
    for (const filename of filesnames) {
      if (!/\w_views?.json/.test(filename)) continue;
      const file = fs.readFileSync(join("./views", filename), { encoding: "utf-8" });
      const fileId = filename.split(".json")[0];
      fs.mkdirSync(`./Query/${fileId}`);
      const view = file.replace(/"function\s*?\(/g, "function (").replace(/}"/g, "}");
      fs.writeFileSync(`./Query/${fileId}/viewMap.ts`, `//@ts-nocheck \n export default ${view}`);
      type += ` ${fileId}: typeof ${fileId},\n`;
      imps += `import ${fileId} from './${fileId}/viewMap';\n`;
      exps += `RootViewMap['${fileId}'] = ${fileId};\n`;
    }
    type += "}\n";
    exps += "\nexport { RootViewMap }";
    fs.writeFileSync("./Query/RootViewMap.ts", `${imps}${type}${exps}`);
    return;
  }
  console.error(`no such file or directory`);
}

genViewMaps();