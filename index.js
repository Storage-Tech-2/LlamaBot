import { spawn } from "child_process";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const entryFile = path.join(process.cwd(), "src", "index.ts");

let tsxCli;
try {
	tsxCli = require.resolve("tsx/cli");
} catch {
	console.error('Could not resolve tsx CLI module. Run "npm install".');
	process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entryFile], {
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
