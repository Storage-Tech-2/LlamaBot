import { spawn } from "child_process";
import { existsSync } from "fs";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const entryFile = path.join(process.cwd(), "src", "index.ts");

function resolveTsxCommand() {
	const unixBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
	const winBin = `${unixBin}.cmd`;

	if (process.platform === "win32" && existsSync(winBin)) {
		return { command: winBin, args: [] };
	}

	if (existsSync(unixBin)) {
		return { command: unixBin, args: [] };
	}

	try {
		const tsxCli = require.resolve("tsx/dist/cli.mjs");
		return { command: process.execPath, args: [tsxCli] };
	} catch {
		throw new Error('Could not resolve tsx. Run "npm install" to install dependencies.');
	}
}

const tsx = resolveTsxCommand();
const child = spawn(tsx.command, [...tsx.args, entryFile], {
	stdio: "inherit",
	shell: false,
	env: process.env
});

child.on("error", (error) => {
	console.error("Failed to launch TypeScript bot entrypoint:", error);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
