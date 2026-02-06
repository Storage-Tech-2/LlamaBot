import { spawn } from "child_process";
import path from "path";

const entryFile = path.join(process.cwd(), "src", "index.ts");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const child = spawn(npxCommand, ["tsx", entryFile], {
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
