import { Bot } from "./Bot.js";
import { APIServer } from "./api/APIServer.js";
import { ChildProcess, spawn, spawnSync } from "child_process";
import fs from "fs/promises";
import { safeJoinPath, safeWorkspacePathOrNull } from "./utils/SafePath.js";

type ManagedPythonServer = {
	stop: () => Promise<void>;
	waitUntilReady: () => Promise<void>;
};

const SHUTDOWN_TIMEOUT_MS = 5_000;
const PYTHON_DIR = safeJoinPath(process.cwd(), 'python');
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

function runCommandWithEnv(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: false,
			env
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

function buildInstallPaths() {
	const defaultCacheRoot = safeJoinPath(process.cwd(), '.python-install-cache');
	const cacheRootEnv = process.env.PYTHON_INSTALL_CACHE_ROOT?.trim();
	const cacheRoot = cacheRootEnv ? (safeWorkspacePathOrNull(cacheRootEnv) || defaultCacheRoot) : defaultCacheRoot;

	const resolveWorkspaceEnvPath = (value: string | undefined, fallbackPath: string): string => {
		const trimmed = value?.trim();
		if (!trimmed) return fallbackPath;
		return safeWorkspacePathOrNull(trimmed) || fallbackPath;
	};

	return {
		tmpDir: resolveWorkspaceEnvPath(process.env.PYTHON_TMPDIR, safeJoinPath(cacheRoot, 'tmp')),
		pipCacheDir: resolveWorkspaceEnvPath(process.env.PIP_CACHE_DIR, safeJoinPath(cacheRoot, 'pip-cache')),
		uvCacheDir: resolveWorkspaceEnvPath(process.env.UV_CACHE_DIR, safeJoinPath(cacheRoot, 'uv-cache'))
	};
}

async function buildInstallEnv(): Promise<NodeJS.ProcessEnv> {
	const installPaths = buildInstallPaths();
	await Promise.all([
		fs.mkdir(installPaths.tmpDir, { recursive: true }),
		fs.mkdir(installPaths.pipCacheDir, { recursive: true }),
		fs.mkdir(installPaths.uvCacheDir, { recursive: true })
	]);

	return {
		...process.env,
		TMPDIR: installPaths.tmpDir,
		PIP_CACHE_DIR: installPaths.pipCacheDir,
		UV_CACHE_DIR: installPaths.uvCacheDir
	};
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
	if (!value) return 10 * 60_000;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 10 * 60_000;
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

	const installEnv = await buildInstallEnv();
	console.log(`Python install TMPDIR=${installEnv.TMPDIR}`);
	console.log(`Python install PIP_CACHE_DIR=${installEnv.PIP_CACHE_DIR}`);
	console.log(`Python install UV_CACHE_DIR=${installEnv.UV_CACHE_DIR}`);

	if (commandExists('uv')) {
		console.log('Installing Python dependencies with uv...');
		await runCommandWithEnv('uv', ['sync'], PYTHON_DIR, installEnv);
		return;
	}

	if (commandExists('python3')) {
		console.log('Installing Python dependencies with python3 -m pip...');
		const pipArgs = ['-m', 'pip', 'install', '-e', '.'];
		if (!isTruthy(process.env.PYTHON_PIP_USE_CACHE)) {
			pipArgs.splice(3, 0, '--no-cache-dir');
		}
		await runCommandWithEnv('python3', pipArgs, PYTHON_DIR, installEnv);
		return;
	}

	if (commandExists('python')) {
		console.log('Installing Python dependencies with python -m pip...');
		const pipArgs = ['-m', 'pip', 'install', '-e', '.'];
		if (!isTruthy(process.env.PYTHON_PIP_USE_CACHE)) {
			pipArgs.splice(3, 0, '--no-cache-dir');
		}
		await runCommandWithEnv('python', pipArgs, PYTHON_DIR, installEnv);
		return;
	}

	throw new Error('No uv/python3/python command found for Python dependency installation.');
}

async function bootstrap() {
	await installPythonDependencies();
	const pythonServer = startPythonServer();
	await pythonServer?.waitUntilReady();
	const bot = new Bot();
	const apiServer = new APIServer(bot);
	await apiServer.start();

	let shuttingDown = false;
	const shutdown = async (reason: string, code: number) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`Shutting down (${reason})...`);
		bot.client.destroy();
		await apiServer.stop();
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
		await apiServer.stop();
		await pythonServer?.stop();
		process.exit(1);
	}
}

void bootstrap();
