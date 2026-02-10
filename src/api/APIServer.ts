import { createReadStream } from "fs";
import fs from "fs/promises";
import { Server } from "http";
import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { Bot } from "../Bot.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import type { GuildHolder } from "../GuildHolder.js";
import type { Submission } from "../submissions/Submission.js";

const DEFAULT_PORT = 4938;
const DEFAULT_HOST = "127.0.0.1";
const DISCORD_EPOCH = 1_420_070_400_000n;

type SubmissionTimestampInfo = {
	createdMs: number | null;
	createdISO: string | null;
	updatedMs: number | null;
	updatedISO: string | null;
};

type SubmissionSummary = {
	id: string;
	name: string;
	status: string;
	threadId: string;
	threadUrl: string;
	timestamp: SubmissionTimestampInfo;
};

function parsePort(value: string | undefined): number {
	if (!value) return DEFAULT_PORT;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
		return DEFAULT_PORT;
	}
	return parsed;
}

export class APIServer {
	private readonly app = express();
	private server: Server | null = null;
	private readonly port: number;
	private readonly host: string;

	constructor(private readonly bot: Bot) {
		this.port = parsePort(process.env.API_SERVER_PORT);
		this.host = process.env.API_SERVER_HOST?.trim() || DEFAULT_HOST;
		this.configureApp();
	}

	public async start(): Promise<void> {
		if (this.server) return;

		await new Promise<void>((resolve, reject) => {
			const server = this.app.listen(this.port, this.host, () => {
				this.server = server;
				console.log(`API server listening on http://${this.host}:${this.port}`);
				resolve();
			});
			server.once("error", reject);
		});
	}

	public async stop(): Promise<void> {
		if (!this.server) return;

		const server = this.server;
		this.server = null;

		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}

	private configureApp(): void {
		this.app.disable("x-powered-by");

		this.app.use(async (req: Request, res: Response, next: NextFunction) => {
			try {
				const isAuthed = await this.authenticate(req, res);
				if (!isAuthed) return;
				next();
			} catch (error) {
				next(error);
			}
		});

		this.app.get(["/ping", "/health", "/healthz"], (_req: Request, res: Response) => {
			this.respondJson(res, 200, {
				ok: true,
				service: "storage-tech-bot-api",
				timestamp: new Date().toISOString()
			});
		});

		this.app.get("/servers", (_req: Request, res: Response) => {
			this.handleGetServers(res);
		});

		this.app.get("/server/:serverId/submissions", async (req: Request, res: Response) => {
			const serverId = this.getParam(req.params.serverId);
			await this.handleGetSubmissions(serverId, res);
		});

		this.app.get("/server/:serverId/submission/:submissionId", async (req: Request, res: Response) => {
			const serverId = this.getParam(req.params.serverId);
			const submissionId = this.getParam(req.params.submissionId);
			await this.handleGetSubmission(serverId, submissionId, res);
		});

		this.app.get("/server/:serverId/submission/:submissionId/attachments/:attachmentId", async (req: Request, res: Response) => {
			const serverId = this.getParam(req.params.serverId);
			const submissionId = this.getParam(req.params.submissionId);
			const attachmentId = this.getParam(req.params.attachmentId);
			await this.handleGetSubmissionAttachment(serverId, submissionId, attachmentId, res);
		});

		this.app.get("/server/:serverId/submission/:submissionId/images/:imageId", async (req: Request, res: Response) => {
			const serverId = this.getParam(req.params.serverId);
			const submissionId = this.getParam(req.params.submissionId);
			const imageId = this.getParam(req.params.imageId);
			await this.handleGetSubmissionImage(serverId, submissionId, imageId, res);
		});

		this.app.use((_req: Request, res: Response) => {
			this.respondJson(res, 404, {
				ok: false,
				error: "Not Found"
			});
		});

		this.app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
			console.error("API request failed:", error);
			if (res.headersSent) return;
			this.respondJson(res, 500, {
				ok: false,
				error: "Internal Server Error"
			});
		});
	}

	private async authenticate(req: Request, res: Response): Promise<boolean> {
		const authHeader = req.header("authorization");
		if (!authHeader) {
			this.respondUnauthorized(res);
			return false;
		}

		const [scheme, tokenValue] = authHeader.trim().split(/\s+/, 2);
		if (!scheme || !tokenValue || scheme.toLowerCase() !== "bearer") {
			this.respondUnauthorized(res);
			return false;
		}

		const tokenRecord = await this.bot.getApiTokenManager().validateToken(tokenValue);
		if (!tokenRecord) {
			this.respondUnauthorized(res);
			return false;
		}

		await this.bot.getApiTokenManager().markTokenUsed(tokenRecord.id);
		return true;
	}

	private handleGetServers(res: Response): void {
		const servers = Array.from(this.bot.guilds.values())
			.map(holder => ({
				id: holder.getGuild().id,
				name: holder.getGuild().name
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		this.respondJson(res, 200, {
			ok: true,
			servers
		});
	}

	private async handleGetSubmissions(serverId: string, res: Response): Promise<void> {
		const guildHolder = this.getGuildHolderOrRespond(serverId, res);
		if (!guildHolder) return;

		const submissionIds = await guildHolder.getSubmissionsManager().getSubmissionsList();
		const submissions = await Promise.all(
			submissionIds.map(id => guildHolder.getSubmissionsManager().getSubmission(id))
		);

		const summaries = await Promise.all(
			submissions
				.filter((submission): submission is Submission => submission !== null)
				.map(submission => this.buildSubmissionSummary(submission))
		);

		summaries.sort((a, b) => (b.timestamp.updatedMs || 0) - (a.timestamp.updatedMs || 0));

		this.respondJson(res, 200, {
			ok: true,
			server: {
				id: guildHolder.getGuild().id,
				name: guildHolder.getGuild().name
			},
			submissions: summaries
		});
	}

	private async handleGetSubmission(serverId: string, submissionId: string, res: Response): Promise<void> {
		const guildHolder = this.getGuildHolderOrRespond(serverId, res);
		if (!guildHolder) return;

		const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId);
		if (!submission) {
			this.respondJson(res, 404, {
				ok: false,
				error: `Submission not found: ${submissionId}`
			});
			return;
		}

		const config = submission.getConfigManager();
		const timestamp = await this.getSubmissionTimestamps(submission);

		this.respondJson(res, 200, {
			ok: true,
			server: {
				id: guildHolder.getGuild().id,
				name: guildHolder.getGuild().name
			},
			submission: {
				id: submission.getId(),
				name: config.getConfig(SubmissionConfigs.NAME),
				status: config.getConfig(SubmissionConfigs.STATUS),
				threadId: config.getConfig(SubmissionConfigs.SUBMISSION_THREAD_ID) || submission.getId(),
				threadUrl: config.getConfig(SubmissionConfigs.SUBMISSION_THREAD_URL),
				archiveChannelId: config.getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID) || null,
				isLocked: config.getConfig(SubmissionConfigs.IS_LOCKED),
				lockReason: config.getConfig(SubmissionConfigs.LOCK_REASON),
				onHold: config.getConfig(SubmissionConfigs.ON_HOLD),
				holdReason: config.getConfig(SubmissionConfigs.HOLD_REASON),
				rejectionReason: config.getConfig(SubmissionConfigs.REJECTION_REASON),
				retractionReason: config.getConfig(SubmissionConfigs.RETRACTION_REASON),
				tags: config.getConfig(SubmissionConfigs.TAGS) || [],
				authors: config.getConfig(SubmissionConfigs.AUTHORS) || [],
				endorsers: config.getConfig(SubmissionConfigs.ENDORSERS),
				images: config.getConfig(SubmissionConfigs.IMAGES) || [],
				attachments: config.getConfig(SubmissionConfigs.ATTACHMENTS) || [],
				timestamp
			}
		});
	}

	private async handleGetSubmissionAttachment(
		serverId: string,
		submissionId: string,
		attachmentId: string,
		res: Response
	): Promise<void> {
		const guildHolder = this.getGuildHolderOrRespond(serverId, res);
		if (!guildHolder) return;

		const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId);
		if (!submission) {
			this.respondJson(res, 404, {
				ok: false,
				error: `Submission not found: ${submissionId}`
			});
			return;
		}

		const attachment = await submission.getAttachmentById(attachmentId);
		if (!attachment) {
			this.respondJson(res, 404, {
				ok: false,
				error: `Attachment not found: ${attachmentId}`
			});
			return;
		}

		if (attachment.path) {
			const filePath = this.resolveSafePath(submission.getAttachmentFolder(), attachment.path);
			if (filePath && await this.fileExists(filePath)) {
				await this.sendFile(res, filePath, this.resolveContentType(attachment.contentType, attachment.name), attachment.name);
				return;
			}
		}

		const fallbackUrl = attachment.downloadUrl || attachment.url;
		if (fallbackUrl) {
			this.redirect(res, fallbackUrl);
			return;
		}

		this.respondJson(res, 404, {
			ok: false,
			error: `Attachment content not available: ${attachmentId}`
		});
	}

	private async handleGetSubmissionImage(
		serverId: string,
		submissionId: string,
		imageId: string,
		res: Response
	): Promise<void> {
		const guildHolder = this.getGuildHolderOrRespond(serverId, res);
		if (!guildHolder) return;

		const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId);
		if (!submission) {
			this.respondJson(res, 404, {
				ok: false,
				error: `Submission not found: ${submissionId}`
			});
			return;
		}

		const images = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [];
		const image = images.find(entry => entry.id === imageId);
		if (!image) {
			this.respondJson(res, 404, {
				ok: false,
				error: `Image not found: ${imageId}`
			});
			return;
		}

		if (image.path) {
			const filePath = this.resolveSafePath(submission.getProcessedImagesFolder(), image.path);
			if (filePath && await this.fileExists(filePath)) {
				await this.sendFile(res, filePath, this.resolveContentType(image.contentType, image.name), image.name);
				return;
			}
		}

		if (image.url) {
			this.redirect(res, image.url);
			return;
		}

		this.respondJson(res, 404, {
			ok: false,
			error: `Image content not available: ${imageId}`
		});
	}

	private getGuildHolderOrRespond(serverId: string, res: Response): GuildHolder | null {
		const guildHolder = this.bot.guilds.get(serverId);
		if (guildHolder) {
			return guildHolder;
		}
		this.respondJson(res, 404, {
			ok: false,
			error: `Server not found: ${serverId}`
		});
		return null;
	}

	private getParam(value: string | string[] | undefined): string {
		if (Array.isArray(value)) {
			return value[0] || "";
		}
		return value || "";
	}

	private async buildSubmissionSummary(submission: Submission): Promise<SubmissionSummary> {
		const config = submission.getConfigManager();
		return {
			id: submission.getId(),
			name: config.getConfig(SubmissionConfigs.NAME) || "Unnamed Submission",
			status: config.getConfig(SubmissionConfigs.STATUS),
			threadId: config.getConfig(SubmissionConfigs.SUBMISSION_THREAD_ID) || submission.getId(),
			threadUrl: config.getConfig(SubmissionConfigs.SUBMISSION_THREAD_URL) || "",
			timestamp: await this.getSubmissionTimestamps(submission)
		};
	}

	private async getSubmissionTimestamps(submission: Submission): Promise<SubmissionTimestampInfo> {
		const config = submission.getConfigManager();
		const threadId = config.getConfig(SubmissionConfigs.SUBMISSION_THREAD_ID) || submission.getId();
		const createdMs = this.getSnowflakeTimestamp(threadId);
		const stats = await fs.stat(submission.getFolderPath()).catch(() => null);
		const updatedMs = stats ? Math.floor(stats.mtimeMs) : null;

		return {
			createdMs,
			createdISO: createdMs ? new Date(createdMs).toISOString() : null,
			updatedMs,
			updatedISO: updatedMs ? new Date(updatedMs).toISOString() : null
		};
	}

	private getSnowflakeTimestamp(snowflake: string): number | null {
		if (!/^\d{17,20}$/.test(snowflake)) {
			return null;
		}
		try {
			return Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH);
		} catch {
			return null;
		}
	}

	private async sendFile(res: Response, filePath: string, contentType: string, fileName: string): Promise<void> {
		const stats = await fs.stat(filePath).catch(() => null);
		if (!stats || !stats.isFile()) {
			this.respondJson(res, 404, {
				ok: false,
				error: "File not found"
			});
			return;
		}

		res.status(200);
		res.setHeader("Content-Type", contentType);
		res.setHeader("Content-Length", stats.size.toString());
		res.setHeader("Content-Disposition", `inline; filename="${this.escapeHeaderValue(fileName)}"`);

		const stream = createReadStream(filePath);
		stream.once("error", (error) => {
			console.error(`Failed to stream file ${filePath}:`, error);
			if (!res.headersSent) {
				this.respondJson(res, 500, {
					ok: false,
					error: "Failed to stream file"
				});
				return;
			}
			res.destroy(error);
		});
		stream.pipe(res);
	}

	private resolveContentType(contentType: string | undefined, fileName: string): string {
		if (contentType && contentType.includes("/")) {
			return contentType;
		}

		const extension = path.extname(fileName).toLowerCase();
		if (extension === ".png") return "image/png";
		if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
		if (extension === ".gif") return "image/gif";
		if (extension === ".webp") return "image/webp";
		if (extension === ".bmp") return "image/bmp";
		if (extension === ".mp4") return "video/mp4";
		if (extension === ".mp3") return "audio/mpeg";
		if (extension === ".zip") return "application/zip";
		if (extension === ".json") return "application/json";
		if (extension === ".txt") return "text/plain; charset=utf-8";
		return "application/octet-stream";
	}

	private escapeHeaderValue(value: string): string {
		return value.replace(/[\\\"\r\n]/g, "_");
	}

	private resolveSafePath(basePath: string, relativePath: string): string | null {
		const resolvedBase = path.resolve(basePath);
		const resolvedPath = path.resolve(basePath, relativePath);
		if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
			return null;
		}
		return resolvedPath;
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private redirect(res: Response, location: string): void {
		res.redirect(302, location);
	}

	private respondUnauthorized(res: Response): void {
		res.setHeader("WWW-Authenticate", 'Bearer realm="storage-tech-bot-api"');
		this.respondJson(res, 401, {
			ok: false,
			error: "Unauthorized"
		});
	}

	private respondJson(res: Response, statusCode: number, payload: Record<string, unknown>): void {
		res.status(statusCode).json(payload);
	}
}
