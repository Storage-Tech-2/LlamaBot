import { Bot } from "./Bot.js";
import { ChildProcess, spawn, spawnSync } from "child_process";
import path from "path";

type ManagedPythonServer = {
	stop: () => Promise<void>;
	waitUntilReady: () => Promise<void>;
};

const SHUTDOWN_TIMEOUT_MS = 5_000;
const PYTHON_DIR = path.join(process.cwd(), 'python');
const READY_POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function commandExists(command: string): boolean {
	const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
	return !result.error;
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: false
		});

		child.stdout?.on('data', (data: Buffer) => {
			process.stdout.write(`[python] ${data.toString()}`);
		});
		child.stderr?.on('data', (data: Buffer) => {
			process.stderr.write(`[python] ${data.toString()}`);
		});

		child.once('error', (error) => {
			reject(error);
		});

		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Command failed (${command} ${args.join(' ')}) with code=${code}, signal=${signal}`));
		});
	});
}

function buildPythonCommand(): { command: string; args: string[]; viaShell: boolean } | null {
	const host = process.env.PYTHON_SERVER_HOST || '127.0.0.1';
	const port = process.env.PYTHON_SERVER_PORT || '8000';
	const customCommand = process.env.PYTHON_SERVER_CMD?.trim();

	if (customCommand) {
		return {
			command: customCommand,
			args: [],
			viaShell: true
		};
	}

	if (commandExists('uv')) {
		return {
			command: 'uv',
			args: ['run', 'uvicorn', 'main:app', '--host', host, '--port', port],
			viaShell: false
		};
	}

	if (commandExists('python3')) {
		return {
			command: 'python3',
			args: ['-m', 'uvicorn', 'main:app', '--host', host, '--port', port],
			viaShell: false
		};
	}

	if (commandExists('python')) {
		return {
			command: 'python',
			args: ['-m', 'uvicorn', 'main:app', '--host', host, '--port', port],
			viaShell: false
		};
	}

	return null;
}

function getPythonHealthUrl(): string {
	const customHealthUrl = process.env.PYTHON_SERVER_HEALTH_URL?.trim();
	if (customHealthUrl) {
		return customHealthUrl;
	}

	const host = process.env.PYTHON_SERVER_HOST || '127.0.0.1';
	const port = process.env.PYTHON_SERVER_PORT || '8000';
	return `http://${host}:${port}/healthz`;
}

function getReadyTimeoutMs(): number {
	const value = process.env.PYTHON_SERVER_READY_TIMEOUT_MS?.trim();
	if (!value) return 120_000;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 120_000;
	return parsed;
}

function startPythonServer(): ManagedPythonServer | null {
	if (isTruthy(process.env.PYTHON_SERVER_DISABLE)) {
		console.log('Python server autostart disabled via PYTHON_SERVER_DISABLE.');
		return null;
	}

	const launch = buildPythonCommand();
	if (!launch) {
		console.warn('Could not autostart Python server: no uv/python3/python command found.');
		return null;
	}

	const child: ChildProcess = spawn(launch.command, launch.args, {
		cwd: PYTHON_DIR,
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: launch.viaShell
	});

	child.stdout?.on('data', (data: Buffer) => {
		process.stdout.write(`[python] ${data.toString()}`);
	});
	child.stderr?.on('data', (data: Buffer) => {
		process.stderr.write(`[python] ${data.toString()}`);
	});

	let stopping = false;

	child.on('exit', (code, signal) => {
		if (!stopping) {
			console.warn(`Python server exited unexpectedly (code=${code}, signal=${signal}).`);
		}
	});

	console.log(`Started Python server in ${PYTHON_DIR}`);

	return {
		waitUntilReady: async () => {
			const healthUrl = getPythonHealthUrl();
			const timeoutMs = getReadyTimeoutMs();
			const startedAt = Date.now();
			console.log(`Waiting for Python server readiness at ${healthUrl}...`);

			while (Date.now() - startedAt < timeoutMs) {
				if (child.exitCode !== null) {
					throw new Error(`Python server exited before becoming ready (code=${child.exitCode}).`);
				}

				try {
					const controller = new AbortController();
					const timeout = setTimeout(() => controller.abort(), 2_000);
					const response = await fetch(healthUrl, { signal: controller.signal });
					clearTimeout(timeout);
					if (response.ok) {
						console.log('Python server is ready.');
						return;
					}
				} catch {
					// Keep polling until timeout.
				}

				await sleep(READY_POLL_INTERVAL_MS);
			}

			throw new Error(`Timed out waiting for Python server readiness after ${timeoutMs}ms.`);
		},
		stop: () =>
			new Promise<void>((resolve) => {
				if (stopping || child.killed || child.exitCode !== null) {
					resolve();
					return;
				}

				stopping = true;
				const timeout = setTimeout(() => {
					if (child.exitCode === null) {
						child.kill('SIGKILL');
					}
				}, SHUTDOWN_TIMEOUT_MS);

				child.once('exit', () => {
					clearTimeout(timeout);
					resolve();
				});

				child.kill('SIGTERM');
			})
	};
}

async function installPythonDependencies(): Promise<void> {
	if (isTruthy(process.env.PYTHON_DEPS_DISABLE)) {
		console.log('Python dependency install disabled via PYTHON_DEPS_DISABLE.');
		return;
	}

	if (commandExists('uv')) {
		console.log('Installing Python dependencies with uv...');
		await runCommand('uv', ['sync'], PYTHON_DIR);
		return;
	}

	if (commandExists('python3')) {
		console.log('Installing Python dependencies with python3 -m pip...');
		await runCommand('python3', ['-m', 'pip', 'install', '-e', '.'], PYTHON_DIR);
		return;
	}

	if (commandExists('python')) {
		console.log('Installing Python dependencies with python -m pip...');
		await runCommand('python', ['-m', 'pip', 'install', '-e', '.'], PYTHON_DIR);
		return;
	}

	throw new Error('No uv/python3/python command found for Python dependency installation.');
}

async function bootstrap() {
	await installPythonDependencies();
	const pythonServer = startPythonServer();
	await pythonServer?.waitUntilReady();
	const bot = new Bot();

	let shuttingDown = false;
	const shutdown = async (reason: string, code: number) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`Shutting down (${reason})...`);
		bot.client.destroy();
		await pythonServer?.stop();
		process.exit(code);
	};

	process.on('SIGINT', () => {
		void shutdown('SIGINT', 0);
	});
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM', 0);
	});
	process.on('unhandledRejection', (error) => {
		console.error('Unhandled promise rejection:', error);
	});
	process.on('uncaughtException', (err) => {
		console.error('Synchronous error caught.', err);
		void shutdown('uncaughtException', 1);
	});

	try {
		await bot.start();
	} catch (error) {
		console.error('Failed to start bot:', error);
		await pythonServer?.stop();
		process.exit(1);
	}
}

void bootstrap();
