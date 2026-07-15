const fs = require("node:fs/promises");
const path = require("node:path");

const REGISTRY_PATH = path.resolve(__dirname, "..", "deployments", "contract-addresses.json");

async function readRegistry() {
    try {
        const raw = await fs.readFile(REGISTRY_PATH, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}

async function writeRegistry(networkName, deployment) {
    await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
    const registry = await readRegistry();
    registry[networkName] = {
        deployedAt: new Date().toISOString(),
        ...deployment,
    };

    await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    return REGISTRY_PATH;
}

module.exports = {
    REGISTRY_PATH,
    readRegistry,
    writeRegistry,
};
