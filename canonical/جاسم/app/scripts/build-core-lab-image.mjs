import { spawn } from "node:child_process";

const pinnedImage = /^(?:[a-z0-9][a-z0-9._\/-]*(?::[a-zA-Z0-9._-]+)?@)?sha256:[a-f0-9]{64}$/;
const baseImage = process.env.JASIM_CORE_LAB_NODE_IMAGE;
const tag = process.env.JASIM_CORE_LAB_IMAGE_TAG || "jasim-core-lab:local";
if (!baseImage || !pinnedImage.test(baseImage)) {
  throw new Error("JASIM_CORE_LAB_NODE_IMAGE must be a digest-pinned Node image");
}
if (!/^[a-z0-9][a-z0-9._\/-]*(?::[a-zA-Z0-9._-]+)?$/.test(tag)) throw new Error("Invalid JASIM_CORE_LAB_IMAGE_TAG");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.JASIM_CORE_LAB_DOCKER_BIN || "docker", args, { shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`docker exited with ${code}`)));
  });
}

await run([
  "build", "--pull=false", "--build-arg", `NODE_IMAGE=${baseImage}`,
  "--file", "services/core-evolution-lab/evaluator-image/Dockerfile", "--tag", tag, ".",
]);
await run(["image", "inspect", "--format", "Core Lab image id: {{.Id}}", tag]);
