const { spawnSync } = require("child_process");
const path = require("path");

const scriptPath = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!scriptPath) {
    console.error("Missing script path");
    process.exit(1);
}

const npmNetwork = process.env.npm_config_network;
const positionalNetwork = extraArgs.find((arg) => !arg.startsWith("-"));
const network = npmNetwork && npmNetwork !== "true" ? npmNetwork : positionalNetwork || "hardhat";
const hardhatArgs = ["hardhat", "run", path.normalize(scriptPath), "--network", network];

const result = spawnSync("npx", hardhatArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status ?? 1);