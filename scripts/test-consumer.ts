import { cp, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

const project = resolve(import.meta.dir, "..");
const ark = resolve(process.env.ARK_DIR ?? join(project, "../ark-of-atrahasis"));
const temp = await mkdtemp("/tmp/deca-consumer-");
async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error("Failed: bun " + args.join(" "));
}
try {
  await cp(join(import.meta.dir, "consumer"), temp, { recursive: true });
  await run(ark, "run", "build");
  await run(project, "run", "build");
  await run(ark, "pm", "pack", "--ignore-scripts", "--quiet", "--filename", join(temp, "ark.tgz"));
  await run(project, "pm", "pack", "--quiet", "--filename", join(temp, "deca.tgz"));
  const manifest = await Bun.file(join(project, "package.json")).json();
  const arkManifest = await Bun.file(join(ark, "package.json")).json();
  const range = manifest.peerDependencies["ark-of-atrahasis"];
  if (!Bun.semver.satisfies(arkManifest.version, range))
    console.info(`Testing local Ark ${arkManifest.version}; release peer range is ${range}.`);
  await Bun.write(
    join(temp, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "ark-of-atrahasis": "file:ark.tgz",
        decagrammaton: "file:deca.tgz",
        vite: manifest.devDependencies.vite,
        vue: manifest.devDependencies.vue,
        typescript: manifest.dependencies.typescript,
        "happy-dom": manifest.devDependencies["happy-dom"],
        ses: arkManifest.devDependencies.ses,
      },
    }),
  );
  await run(temp, "install");
  await run(
    temp,
    "run",
    "tsc",
    "--strict",
    "--module",
    "preserve",
    "--target",
    "es2023",
    "--skipLibCheck",
    "--noEmit",
    "public.ts",
  );
  await run(temp, "run", "vite", "build");
  await run(temp, "host.ts");
} finally {
  await rm(temp, { force: true, recursive: true });
}
