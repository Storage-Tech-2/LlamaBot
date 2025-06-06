import crypto from 'node:crypto';

export type UUID = string;

export function getUUID(): UUID {
    return crypto.randomUUID();
}