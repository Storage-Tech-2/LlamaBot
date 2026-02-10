import { ChatInputCommandInteraction, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { SysAdmin } from "../Bot.js";
import type { APITokenRecord } from "../api/APITokenManager.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral, splitIntoChunks } from "../utils/Util.js";

export class TokenCommand implements Command {
    getID(): string {
        return "token";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription("API auth token management")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .setContexts(InteractionContextType.Guild)
            .addSubcommand(subcommand =>
                subcommand
                    .setName("get")
                    .setDescription("Generate an API auth token")
                    .addStringOption(option =>
                        option
                            .setName("label")
                            .setDescription("Optional label for this token")
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName("list")
                    .setDescription("List API auth tokens (SysAdmin only)")
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName("revoke")
                    .setDescription("Revoke an API auth token (SysAdmin only)")
                    .addStringOption(option =>
                        option
                            .setName("tokenid")
                            .setDescription("Token ID to revoke")
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName("delete")
                    .setDescription("Delete an API auth token (SysAdmin only)")
                    .addStringOption(option =>
                        option
                            .setName("tokenid")
                            .setDescription("Token ID to delete")
                            .setRequired(true)
                    )
            );

        return data as SlashCommandBuilder;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "get") {
            await this.getToken(guildHolder, interaction);
            return;
        }
        if (subcommand === "list") {
            await this.listTokens(guildHolder, interaction);
            return;
        }
        if (subcommand === "revoke") {
            await this.revokeToken(guildHolder, interaction);
            return;
        }
        if (subcommand === "delete") {
            await this.deleteToken(guildHolder, interaction);
            return;
        }

        await replyEphemeral(interaction, "Unknown token subcommand.");
    }

    private async getToken(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const label = interaction.options.getString("label", false) || guildHolder.getGuild().name;
            const tokenManager = guildHolder.getBot().getApiTokenManager();
            const result = await tokenManager.createToken(interaction.user.id, interaction.user.tag, label);

            const safeLabel = result.record.label ? result.record.label.replace(/\s+/g, " ").trim() : "(none)";
            await replyEphemeral(
                interaction,
                [
                    "Generated a new API token.",
                    `Token ID: \`${result.record.id}\``,
                    `Label: \`${safeLabel}\``,
                    `Token: \`${result.token}\``,
                    "",
                    "Use header:",
                    "`Authorization: Bearer <token>`",
                    "Store this token securely. It is shown only once."
                ].join("\n")
            );
        } catch (error: any) {
            console.error("Failed to generate API token:", error);
            await replyEphemeral(interaction, `Failed to generate token: ${error?.message || error}`);
        }
    }

    private async listTokens(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (interaction.user.id !== SysAdmin) {
            await replyEphemeral(interaction, "You are not authorized to list API tokens.");
            return;
        }

        try {
            const tokenManager = guildHolder.getBot().getApiTokenManager();
            const tokens = await tokenManager.listTokens();
            if (tokens.length === 0) {
                await replyEphemeral(interaction, "No API tokens have been created yet.");
                return;
            }

            const lines = [
                "## API Tokens",
                ...tokens.map(token => this.formatTokenLine(token))
            ];

            const chunks = splitIntoChunks(lines.join("\n"), 1900);
            for (const chunk of chunks) {
                await replyEphemeral(interaction, chunk);
            }
        } catch (error: any) {
            console.error("Failed to list API tokens:", error);
            await replyEphemeral(interaction, `Failed to list tokens: ${error?.message || error}`);
        }
    }

    private async revokeToken(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (interaction.user.id !== SysAdmin) {
            await replyEphemeral(interaction, "You are not authorized to revoke API tokens.");
            return;
        }

        try {
            const tokenId = interaction.options.getString("tokenid", true).trim();
            const tokenManager = guildHolder.getBot().getApiTokenManager();
            const status = await tokenManager.revokeToken(tokenId, interaction.user.id);

            if (status === "revoked") {
                await replyEphemeral(interaction, `Revoked API token \`${tokenId}\`.`);
                return;
            }

            if (status === "already_revoked") {
                await replyEphemeral(interaction, `API token \`${tokenId}\` is already revoked.`);
                return;
            }

            await replyEphemeral(interaction, `API token \`${tokenId}\` was not found.`);
        } catch (error: any) {
            console.error("Failed to revoke API token:", error);
            await replyEphemeral(interaction, `Failed to revoke token: ${error?.message || error}`);
        }
    }

    private async deleteToken(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (interaction.user.id !== SysAdmin) {
            await replyEphemeral(interaction, "You are not authorized to delete API tokens.");
            return;
        }

        try {
            const tokenId = interaction.options.getString("tokenid", true).trim();
            const tokenManager = guildHolder.getBot().getApiTokenManager();
            const removed = await tokenManager.deleteToken(tokenId);

            if (!removed) {
                await replyEphemeral(interaction, `API token \`${tokenId}\` was not found.`);
                return;
            }

            await replyEphemeral(interaction, `Deleted API token \`${tokenId}\`.`);
        } catch (error: any) {
            console.error("Failed to delete API token:", error);
            await replyEphemeral(interaction, `Failed to delete token: ${error?.message || error}`);
        }
    }

    private formatTokenLine(token: APITokenRecord): string {
        const state = token.revokedAt ? "revoked" : "active";
        const label = token.label ? token.label.replace(/\s+/g, " ").trim() : "(none)";
        const created = this.formatTimestamp(token.createdAt);
        const lastUsed = this.formatTimestamp(token.lastUsedAt);
        const revoked = this.formatTimestamp(token.revokedAt);
        return `- \`${token.id}\` [${state}] label=\`${label}\` created=${created} last_used=${lastUsed} revoked=${revoked} creator=\`${token.createdByUserTag}\` (\`${token.createdByUserId}\`)`;
    }

    private formatTimestamp(value: number | null): string {
        if (!value) {
            return "never";
        }
        return new Date(value).toISOString();
    }
}
