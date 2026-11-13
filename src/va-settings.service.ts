import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { adapterFor, PluginPrefs } from '@huloglobal/vendure-licence-sdk';
import { DEFAULT_VA_SETTINGS, sanitiseSettings, VaSettings } from './va-settings';
import { newSalt, utcDay } from './privacy-utils';

const SHORT_ID = 'vendure-plugin-visitor-analytics';
const SETTINGS_KEY = 'va.settings';
const SALT_KEY = 'va.salt';
const CACHE_MS = 30_000;

/**
 * Runtime settings and the cookieless salt, in the shared `hulo_plugin_prefs`
 * table. Settings are cached for 30 s (the ingest path reads them on every
 * beacon); a save clears the cache in this process at once.
 */
@Injectable()
export class VaSettingsService implements OnApplicationBootstrap {
    private readonly prefs: PluginPrefs;
    private cache: { at: number; value: VaSettings } | null = null;
    private salt: { day: string; salt: string } | null = null;

    constructor(private readonly connection: TransactionalConnection) {
        this.prefs = new PluginPrefs((sql, params, opts) => adapterFor(this.connection.rawConnection).query(sql, params, opts), SHORT_ID);
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.prefs.ensureTable();
    }

    async get(): Promise<VaSettings> {
        const now = Date.now();
        if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
        let value = DEFAULT_VA_SETTINGS;
        try {
            const raw = await this.prefs.get(SETTINGS_KEY);
            if (raw) value = sanitiseSettings(JSON.parse(raw));
        } catch { /* defaults */ }
        this.cache = { at: now, value };
        return value;
    }

    async update(patch: any): Promise<VaSettings> {
        this.cache = null;
        const next = sanitiseSettings(patch, await this.get());
        await this.prefs.set(SETTINGS_KEY, JSON.stringify(next));
        this.cache = { at: Date.now(), value: next };
        return next;
    }

    /**
     * The salt of the current UTC day for cookieless ids. Only today's salt is
     * kept: the first call of a new day replaces it (compare-and-set, so every
     * process agrees), which deletes yesterday's.
     */
    async dailySalt(now = new Date()): Promise<string> {
        const day = utcDay(now);
        if (this.salt?.day === day) return this.salt.salt;
        for (let attempt = 0; attempt < 3; attempt++) {
            const raw = await this.prefs.get(SALT_KEY);
            let stored: { day?: string; salt?: string } = {};
            try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
            if (stored.day === day && typeof stored.salt === 'string' && /^[a-f0-9]{32}$/.test(stored.salt)) {
                this.salt = { day, salt: stored.salt };
                return stored.salt;
            }
            const next = JSON.stringify({ day, salt: newSalt() });
            if (await this.prefs.cas(SALT_KEY, raw, next)) {
                this.salt = JSON.parse(next);
                return this.salt!.salt;
            }
        }
        // The prefs table is unavailable: a per-process salt still never leaves memory.
        this.salt = { day, salt: newSalt() };
        return this.salt.salt;
    }
}
