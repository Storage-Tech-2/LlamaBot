import { spawn } from "child_process";
import path from "path";

const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const entryFile = path.join(process.cwd(), "src", "index.ts");

const child = spawn(tsxPath, [entryFile], {
	stdio: "inherit",
	shell: process.platform === "win32",
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
