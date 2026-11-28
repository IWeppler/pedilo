// Recorta package.json y package-lock.json del monorepo a los workspaces que se le pasan,
// para que la imagen de la API no instale las apps (Expo, React Native, Next).
// `npm prune` no alcanza: los peers opcionales de Expo se sostienen entre ellos.
//   node prune-lockfile.mjs services/api packages/domain
// Recorre el lockfile como lo resuelve Node (node_modules hacia arriba) y se queda con lo
// que se alcanza desde esos workspaces por dependencies, optionalDependencies y peers
// obligatorios. Las versiones no cambian: npm ci instala exactamente lo que queda.
import { readFileSync, writeFileSync } from "node:fs";

const keep = process.argv.slice(2);
if (keep.length === 0) throw new Error("Uso: node prune-lockfile.mjs <workspace>...");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const all = lock.packages;

pkg.workspaces = keep;
all[""].workspaces = keep;
// Sin devDependencies: la imagen no las instala, y así npm ci no las busca en el lockfile.
for (const entry of [pkg, all[""]]) delete entry.devDependencies;
for (const ws of keep) {
  const file = `${ws}/package.json`;
  const wsPkg = JSON.parse(readFileSync(file, "utf8"));
  delete wsPkg.devDependencies;
  writeFileSync(file, JSON.stringify(wsPkg, null, 2));
  delete all[ws].devDependencies;
}

/** Dónde resuelve Node `name` pedido desde el paquete en `from`. */
function resolve(from, name) {
  let dir = from;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (all[candidate]) return candidate;
    if (!dir) return null;
    const i = dir.lastIndexOf("/node_modules/");
    dir = i === -1 ? "" : dir.slice(0, i);
  }
}

const reached = new Set([""]);
const queue = [];
const visit = (path) => {
  if (reached.has(path)) return;
  reached.add(path);
  queue.push(path);
};
for (const ws of keep) visit(ws);

while (queue.length) {
  const path = queue.pop();
  const entry = all[path];
  // Un workspace aparece como link en node_modules/@scope/name -> carpeta.
  if (entry.link) {
    visit(entry.resolved);
    continue;
  }
  const optionalPeers = entry.peerDependenciesMeta ?? {};
  const names = [
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}).filter((n) => !optionalPeers[n]?.optional),
  ];
  for (const name of names) {
    const target = resolve(path, name);
    if (target) visit(target);
  }
  // El link del workspace en node_modules, para que npm lo cree.
  if (keep.includes(path) && entry.name) {
    const link = `node_modules/${entry.name}`;
    if (all[link]?.link) reached.add(link);
  }
}

const before = Object.keys(all).length;
lock.packages = Object.fromEntries(Object.entries(all).filter(([p]) => reached.has(p)));
writeFileSync("package.json", JSON.stringify(pkg, null, 2));
writeFileSync("package-lock.json", JSON.stringify(lock, null, 2));
console.log(`lockfile: ${before} -> ${Object.keys(lock.packages).length} entradas`);
