import { createHash, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs/promises";
import path from "path";

const MIN_LAST_USED_UPDATE_INTERVAL_MS = 30_000;

export type APITokenRecord = {
	id: string;
	label: string;
	hash: string;
	scopeType: "global" | "server";
	serverId: string | null;
	serverName: string | null;
	usageCount: number;
	createdAt: number;
	createdByUserId: string;
	createdByUserTag: string;
	lastUsedAt: number | null;
	revokedAt: number | null;
	revokedByUserId: string | null;
};

type APITokensFile = {
	tokens: APITokenRecord[];
};

export type CreateAPITokenResult = {
	token: string;
	record: APITokenRecord;
};

export type APITokenScope =
	| {
		type: "global";
	}
	| {
		type: "server";
		serverId: string;
		serverName?: string;
	};

export type RevokeAPITokenStatus = "revoked" | "already_revoked" | "not_found";

export class APITokenManager {
	private loaded = false;
	private tokens: APITokenRecord[] = [];

	constructor(private readonly filePath: string) { }

	public async load(): Promise<void> {
		try {
			const raw = await fs.readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(raw) as APITokensFile | APITokenRecord[];
			const tokenCandidates = Array.isArray(parsed) ? parsed : parsed.tokens;
			if (!Array.isArray(tokenCandidates)) {
				this.tokens = [];
				this.loaded = true;
				return;
			}
			this.tokens = tokenCandidates
				.map(candidate => this.normalizeTokenRecord(candidate))
				.filter((token): token is APITokenRecord => token !== null);
		} catch {
			this.tokens = [];
		}

		this.loaded = true;
	}

	public async createToken(
		createdByUserId: string,
		createdByUserTag: string,
		label?: string,
		scope: APITokenScope = { type: "global" }
	): Promise<CreateAPITokenResult> {
		await this.ensureLoaded();

		const token = randomBytes(32).toString("hex");
		let id = randomBytes(8).toString("hex");
		while (this.tokens.some(existing => existing.id === id)) {
			id = randomBytes(8).toString("hex");
		}

		const record: APITokenRecord = {
			id,
			label: (label || "").trim(),
			hash: this.hashToken(token),
			scopeType: scope.type,
			serverId: scope.type === "server" ? scope.serverId : null,
			serverName: scope.type === "server" ? (scope.serverName || "").trim() || null : null,
			usageCount: 0,
			createdAt: Date.now(),
			createdByUserId,
			createdByUserTag,
			lastUsedAt: null,
			revokedAt: null,
			revokedByUserId: null
		};

		this.tokens.push(record);
		await this.save();

		return {
			token,
			record: { ...record }
		};
	}

	public async listTokens(): Promise<APITokenRecord[]> {
		await this.ensureLoaded();
		return [...this.tokens]
			.sort((a, b) => b.createdAt - a.createdAt)
			.map(token => ({ ...token }));
	}

	public async validateToken(tokenValue: string): Promise<APITokenRecord | null> {
		await this.ensureLoaded();
		const cleaned = tokenValue.trim();
		if (!cleaned) {
			return null;
		}

		const hash = this.hashToken(cleaned);
		const token = this.tokens.find(candidate => {
			if (candidate.revokedAt !== null) {
				return false;
			}
			return this.hashesEqual(candidate.hash, hash);
		});
		if (!token) {
			return null;
		}
		return { ...token };
	}

	public isTokenAllowedForServer(token: APITokenRecord, serverId: string): boolean {
		if (token.scopeType === "global") {
			return true;
		}
		return token.serverId === serverId;
	}

	public async markTokenUsed(tokenId: string): Promise<void> {
		await this.ensureLoaded();
		const token = this.tokens.find(candidate => candidate.id === tokenId);
		if (!token || token.revokedAt !== null) {
			return;
		}

		const now = Date.now();
		token.usageCount += 1;

		if (token.lastUsedAt === null || now - token.lastUsedAt >= MIN_LAST_USED_UPDATE_INTERVAL_MS) {
			token.lastUsedAt = now;
		}

		await this.save();
	}

	public async revokeToken(tokenId: string, revokedByUserId: string): Promise<RevokeAPITokenStatus> {
		await this.ensureLoaded();
		const token = this.tokens.find(candidate => candidate.id === tokenId);
		if (!token) {
			return "not_found";
		}
		if (token.revokedAt !== null) {
			return "already_revoked";
		}

		token.revokedAt = Date.now();
		token.revokedByUserId = revokedByUserId;
		await this.save();
		return "revoked";
	}

	public async deleteToken(tokenId: string): Promise<boolean> {
		await this.ensureLoaded();
		const before = this.tokens.length;
		this.tokens = this.tokens.filter(token => token.id !== tokenId);
		if (this.tokens.length === before) {
			return false;
		}
		await this.save();
		return true;
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return;
		}
		await this.load();
	}

	private hashToken(tokenValue: string): string {
		return createHash("sha256").update(tokenValue).digest("hex");
	}

	private hashesEqual(left: string, right: string): boolean {
		const leftBuffer = Buffer.from(left);
		const rightBuffer = Buffer.from(right);
		if (leftBuffer.length !== rightBuffer.length) {
			return false;
		}
		return timingSafeEqual(leftBuffer, rightBuffer);
	}

	private normalizeTokenRecord(candidate: unknown): APITokenRecord | null {
		if (typeof candidate !== "object" || candidate === null) {
			return null;
		}

		const record = candidate as Partial<APITokenRecord>;
		if (
			typeof record.id !== "string" ||
			typeof record.hash !== "string" ||
			typeof record.createdAt !== "number" ||
			typeof record.createdByUserId !== "string" ||
			typeof record.createdByUserTag !== "string"
		) {
			return null;
		}

		const isServerScoped = record.scopeType === "server" && typeof record.serverId === "string" && record.serverId.length > 0;
		const scopeType: "global" | "server" = isServerScoped ? "server" : "global";
		const serverId = isServerScoped ? record.serverId as string : null;
		const serverName = isServerScoped && typeof record.serverName === "string" ? record.serverName : null;
		const usageCount = typeof record.usageCount === "number" && Number.isFinite(record.usageCount) && record.usageCount >= 0
			? Math.floor(record.usageCount)
			: 0;

		return {
			id: record.id,
			label: typeof record.label === "string" ? record.label : "",
			hash: record.hash,
			scopeType,
			serverId,
			serverName,
			usageCount,
			createdAt: record.createdAt,
			createdByUserId: record.createdByUserId,
			createdByUserTag: record.createdByUserTag,
			lastUsedAt: typeof record.lastUsedAt === "number" ? record.lastUsedAt : null,
			revokedAt: typeof record.revokedAt === "number" ? record.revokedAt : null,
			revokedByUserId: typeof record.revokedByUserId === "string" ? record.revokedByUserId : null
		};
	}

	private async save(): Promise<void> {
		const dir = path.dirname(this.filePath);
		await fs.mkdir(dir, { recursive: true });
		const payload: APITokensFile = { tokens: this.tokens };
		await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
	}
}
