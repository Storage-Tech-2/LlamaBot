export type ParsedStringOption = { provided: boolean, value?: string | null, error?: string };
export type ParsedNumberOption = { provided: boolean, value?: number | null, error?: string };

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
