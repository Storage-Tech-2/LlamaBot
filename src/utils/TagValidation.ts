export type ParsedStringOption = { provided: boolean, value?: string | null, error?: string };
export type ParsedNumberOption = { provided: boolean, value?: number | null, error?: string };

const SHORTCODE_TO_UNICODE: Record<string, string> = {
    green_circle: '🟢',
    red_circle: '🔴',
    orange_circle: '🟠',
    yellow_circle: '🟡',
    blue_circle: '🔵',
    purple_circle: '🟣',
    brown_circle: '🟤',
    black_circle: '⚫',
    white_circle: '⚪',
    green_square: '🟩',
    red_square: '🟥',
    orange_square: '🟧',
    yellow_square: '🟨',
    blue_square: '🟦',
    purple_square: '🟪',
    brown_square: '🟫',
    white_square: '⬜',
    black_square: '⬛',
    white_check_mark: '✅',
    check_mark_button: '✅',
    heavy_check_mark: '✔️',
    x: '❌',
    cross_mark: '❌',
    warning: '⚠️',
    exclamation: '❗',
    question: '❓',
    sparkles: '✨',
    star: '⭐',
    star2: '🌟',
    fire: '🔥',
    zap: '⚡️',
    heart: '❤️',
    green_heart: '💚',
    blue_heart: '💙',
    purple_heart: '💜',
    yellow_heart: '💛',
    orange_heart: '🧡',
    black_heart: '🖤',
    white_heart: '🤍',
    brown_heart: '🤎',
    recycle: '♻️'
};

export function parseEmojiOption(raw: string | null, allowClear: boolean): ParsedStringOption {
    if (raw === null) {
        return { provided: false };
    }
    const trimmed = raw.trim();
    if (!trimmed.length) {
        return { provided: false };
    }
    const lowered = trimmed.toLowerCase();
    if (allowClear && (lowered === 'clear' || lowered === 'none')) {
        return { provided: true, value: null };
    }
    if (trimmed.length > 50) {
        return { provided: true, error: 'Emoji value is too long.' };
    }

    // Reject Discord custom emoji markup
    if (/^<a?:\w+:\d+>$/.test(trimmed)) {
        return { provided: true, error: 'Custom server emojis are not supported. Use a Unicode emoji like ✅.' };
    }

    // Try to resolve shortcode formats like :green_circle:
    const shortcodeMatch = trimmed.match(/^:([a-z0-9_+.-]+):$/i);
    if (shortcodeMatch) {
        const key = shortcodeMatch[1].toLowerCase();
        const mapped = SHORTCODE_TO_UNICODE[key];
        if (mapped) {
            return { provided: true, value: mapped };
        }
        return { provided: true, error: `Unknown emoji shortcode "${shortcodeMatch[0]}". Please use a Unicode emoji like ✅.` };
    }

    // Validate that it contains a Unicode emoji
    if (!/\p{Extended_Pictographic}/u.test(trimmed)) {
        return { provided: true, error: 'Emoji must be a Unicode emoji (e.g., ✅).' };
    }

    return { provided: true, value: trimmed };
}

export function parseColorWebOption(raw: string | null, allowClear: boolean): ParsedStringOption {
    if (raw === null) {
        return { provided: false };
    }
    const trimmed = raw.trim();
    if (!trimmed.length) {
        return { provided: false };
    }
    const lowered = trimmed.toLowerCase();
    if (allowClear && (lowered === 'clear' || lowered === 'none')) {
        return { provided: true, value: null };
    }

    const normalized = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return { provided: true, error: 'Color must be a 6-digit hex code (e.g., #ff8800).' };
    }

    return { provided: true, value: `#${normalized.toLowerCase()}` };
}

export function parseColorModOption(raw: string | null, allowClear: boolean): ParsedNumberOption {
    if (raw === null) {
        return { provided: false };
    }
    const trimmed = raw.trim();
    if (!trimmed.length) {
        return { provided: false };
    }
    const lowered = trimmed.toLowerCase();
    if (allowClear && (lowered === 'clear' || lowered === 'none')) {
        return { provided: true, value: null };
    }

    let parsed: number | null = null;
    const hexMatch = lowered.match(/^0x([0-9a-f]{6,8})$/) || lowered.match(/^#([0-9a-f]{6,8})$/) || lowered.match(/^([0-9a-f]{6,8})$/);
    if (hexMatch) {
        parsed = Number.parseInt(hexMatch[1], 16);
    } else if (/^\d+$/.test(trimmed)) {
        parsed = Number.parseInt(trimmed, 10);
    }

    if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 0xFFFFFFFF) {
        return { provided: true, error: 'Embed color must be a hex value (e.g., 0xFF8800) or a non-negative integer.' };
    }

    return { provided: true, value: parsed };
}
