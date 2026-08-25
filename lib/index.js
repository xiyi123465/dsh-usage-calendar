/**
 * dsh-usage-calendar — server half.
 *
 * Registers two read-only, loopback-only endpoints on the web server:
 *   GET /api/usage-calendar/usage   — per-day token usage (all sessions),
 *                                     cache hit rates, and estimated spend
 *   GET /api/usage-calendar/balance — DeepSeek account balance
 *
 * Usage aggregation is INCREMENTAL: per-session fold state is cached in
 * memory and persisted to `<DSH_HOME>/storages/usage-calendar-cache.json`.
 * Live sessions fold their in-memory tail; persisted sessions use the
 * storage backend's opaque revision when available. Steady-state cost stays
 * O(new events) no matter how large the logs grow.
 *
 * Balance is queried with Node's global fetch (Bearer auth) at request time
 * through the credentials seam; nothing is stored by this plugin.
 *
 * @module dsh-usage-calendar
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
	applyUsageDelta,
	createUsageState,
	mergeInto,
	renderUsage,
	zeroBuckets
} from "./usage.js";

/** Stable Cordis plugin name. */
const name = "usage-calendar";

/** Services required before this plugin activates. */
const inject = ["webServer", "credentials", "sessions", "sessionPersistence", "settings"];

const USAGE_PATH = "/api/usage-calendar/usage";
const BALANCE_PATH = "/api/usage-calendar/balance";
const UPSTREAM_TIMEOUT_MS = 15000;
const CACHE_VERSION = 1;
/** Balance upstream cache: 1s so 1s client polls show near-real-time balance. */
const BALANCE_TTL_MS = 1000;
/** Minimum interval between disk writes of the usage cache. */
const CACHE_SAVE_MIN_MS = 10000;
const REFRESH_INTERVAL_MS = 300000;

/** Default DeepSeek connection facts when the settings namespace is absent. */
const DEEPSEEK_DEFAULTS = {
	apiKeyEnv: "DEEPSEEK_API_KEY",
	baseURL: "https://api.deepseek.com"
};

/** Write a JSON response. */
function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}

/**
 * Loopback fence, primary on the PEER SOCKET address (not the
 * client-controllable Host header): the request must come from a loopback
 * interface. IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is normalized.
 */
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const ipv4 = a.startsWith("::ffff:") ? a.slice(7) : a;
	const octets = ipv4.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Parse a Host header without breaking bracketed or bare IPv6 literals. */
function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return host;
	if (lastColon === -1) return host.replace(/\.$/, "");
	if (!/^\d+$/.test(host.slice(lastColon + 1))) return null;
	return host.slice(0, lastColon).replace(/\.$/, "");
}

function isLoopbackHostHeader(req) {
	const name = hostNameOf(req.headers.host);
	return name === "localhost" || isLoopbackAddress(name);
}

/** Refuse non-loopback callers and non-GET methods before any work. */
function rejectForeignCaller(req, res) {
	if (req.method !== "GET") {
		res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
		return true;
	}
	const peer = req.socket?.remoteAddress;
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	json(res, 403, { ok: false, error: "forbidden" });
	return true;
}

//#region incremental cache
/** Cache file location under the dsh home. */
function cachePath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "usage-calendar-cache.json");
}

let loadedCache = null;
let loadPromise = null;
let inflight = null;
let cacheDirty = false;
let lastSaveAt = 0;

function num0(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Serialize one session's fold state (Maps → plain objects). */
function serializeSession(state) {
	const days = {};
	for (const [date, entry] of state.days) {
		const models = {};
		for (const [model, buckets] of entry.models) models[model] = { ...buckets };
		days[date] = { totals: { ...entry.totals }, samples: entry.samples, models };
	}
	return {
		kind: state.kind ?? "persisted",
		consumed: state.consumed ?? 0,
		...(state.revision === void 0 ? {} : { revision: state.revision }),
		days,
		lastSample: state.lastSample === null ? null : {
			key: state.lastSample.key,
			day: state.lastSample.day,
			model: state.lastSample.model,
			buckets: { ...state.lastSample.buckets }
		},
		currentModel: state.currentModel
	};
}

/** Parse a serialized session entry back into fold state (lenient). */
function parseSession(raw) {
	const state = createUsageState();
	if (raw === null || typeof raw !== "object") return state;
	state.kind = typeof raw.kind === "string" ? raw.kind : "persisted";
	state.consumed = Number.isSafeInteger(raw.consumed) ? raw.consumed : 0;
	if (typeof raw.revision === "string") state.revision = raw.revision;
	if (raw.days !== null && typeof raw.days === "object") {
		for (const [date, entry] of Object.entries(raw.days)) {
			if (entry === null || typeof entry !== "object") continue;
			const target = { totals: zeroBuckets(), samples: 0, models: new Map() };
			const totals = entry.totals;
			if (totals !== null && typeof totals === "object") {
				target.totals.inputTokens = num0(totals.inputTokens);
				target.totals.outputTokens = num0(totals.outputTokens);
				target.totals.cacheReadTokens = num0(totals.cacheReadTokens);
				target.totals.cacheWriteTokens = num0(totals.cacheWriteTokens);
				target.totals.reasoningTokens = num0(totals.reasoningTokens);
			}
			target.samples = Number.isSafeInteger(entry.samples) ? entry.samples : 0;
			if (entry.models !== null && typeof entry.models === "object") {
				for (const [model, buckets] of Object.entries(entry.models)) {
					if (buckets === null || typeof buckets !== "object") continue;
					target.models.set(model, {
						inputTokens: num0(buckets.inputTokens),
						outputTokens: num0(buckets.outputTokens),
						cacheReadTokens: num0(buckets.cacheReadTokens),
						cacheWriteTokens: num0(buckets.cacheWriteTokens),
						reasoningTokens: num0(buckets.reasoningTokens)
					});
				}
			}
			state.days.set(date, target);
		}
	}
	if (
		raw.lastSample !== null &&
		raw.lastSample !== void 0 &&
		typeof raw.lastSample === "object" &&
		typeof raw.lastSample.key === "string" &&
		typeof raw.lastSample.day === "string"
	) {
		const buckets = raw.lastSample.buckets ?? {};
		state.lastSample = {
			key: raw.lastSample.key,
			day: raw.lastSample.day,
			model: typeof raw.lastSample.model === "string" ? raw.lastSample.model : "unknown/unknown",
			buckets: {
				inputTokens: num0(buckets.inputTokens),
				outputTokens: num0(buckets.outputTokens),
				cacheReadTokens: num0(buckets.cacheReadTokens),
				cacheWriteTokens: num0(buckets.cacheWriteTokens),
				reasoningTokens: num0(buckets.reasoningTokens)
			}
		};
	}
	if (typeof raw.currentModel === "string") state.currentModel = raw.currentModel;
	return state;
}

/** Load the cache once per process; any corruption degrades to a fresh cache. */
async function loadCache() {
	if (loadedCache !== null) return loadedCache;
	loadPromise ??= (async () => {
		const fresh = { version: CACHE_VERSION, sessions: {} };
		try {
			const raw = await readFile(cachePath(), "utf8");
			const parsed = JSON.parse(raw);
			if (
				parsed !== null &&
				typeof parsed === "object" &&
				parsed.version === CACHE_VERSION &&
				parsed.sessions !== null &&
				typeof parsed.sessions === "object"
			) {
				const sessions = {};
				for (const [id, entry] of Object.entries(parsed.sessions)) {
					if (typeof id === "string" && id.length > 0) sessions[id] = parseSession(entry);
				}
				return { version: CACHE_VERSION, sessions };
			}
		} catch {
			/* first run or corrupt cache */
		}
		return fresh;
	})();
	loadedCache = await loadPromise;
	return loadedCache;
}

/** Persist the cache atomically (temp + rename); failures are logged, never fatal. */
async function saveCache(ctx, cache) {
	try {
		const path = cachePath();
		await mkdir(dirname(path), { recursive: true });
		const serialized = { version: CACHE_VERSION, sessions: {} };
		for (const [id, state] of Object.entries(cache.sessions)) serialized.sessions[id] = serializeSession(state);
		const tmp = `${path}.tmp`;
		await writeFile(tmp, JSON.stringify(serialized), "utf8");
		await rename(tmp, path);
	} catch (error) {
		ctx.logger.warn(`usage-calendar: saving usage cache failed: ${String(error)}`);
	}
}

/** Single-flight guard: concurrent requests share one aggregation run. */
function withLock(run) {
	if (inflight !== null) return inflight;
	inflight = run().finally(() => {
		inflight = null;
	});
	return inflight;
}
//#endregion

/**
 * Collect per-day usage across live and persisted sessions, incrementally.
 * Live sessions fold only the events added since the last fold; an
 * in-memory log that SHRANK below the folded cursor was rebuilt after a
 * restart, so the session is refolded from scratch. Persisted sessions are
 * skipped when the backend's opaque revision is unchanged; a gap or an
 * empty delta means the log was truncated/rewritten, so refold from scratch.
 */
export async function collectUsage(ctx) {
	return withLock(async () => {
		const cache = await loadCache();
		let dirty = false;
		const live = ctx.get("sessions");
		const attached = new Set();
		if (live !== void 0) {
			for (const session of live.list()) {
				attached.add(session.id);
				const state = cache.sessions[session.id] ?? createUsageState();
				if (state.kind !== "live") {
					state.days = new Map();
					state.lastSample = null;
					state.currentModel = null;
					state.consumed = 0;
				}
				const count = session.events.length;
				if (count < (state.consumed ?? 0)) {
					state.days = new Map();
					state.lastSample = null;
					state.currentModel = null;
					state.consumed = 0;
				}
				if ((state.consumed ?? 0) < count) {
					applyUsageDelta(state, session.events.slice(state.consumed ?? 0));
					state.consumed = count;
					dirty = true;
				}
				state.kind = "live";
				cache.sessions[session.id] = state;
			}
		}
		const persistence = ctx.get("sessionPersistence");
		const persistedIds = new Set();
		if (persistence !== void 0) {
			let snapshots = null;
			if (typeof persistence.listSnapshots === "function") {
				try {
					snapshots = await persistence.listSnapshots();
				} catch (error) {
					ctx.logger.warn(`usage-calendar: listSnapshots failed, falling back to list(): ${String(error)}`);
				}
			}
			const metas = snapshots !== null ? snapshots.map((entry) => entry.header) : await persistence.list();
			const revisionOf = new Map();
			if (snapshots !== null) for (const entry of snapshots) revisionOf.set(entry.header.id, entry.revision);
			for (const meta of metas) {
				persistedIds.add(meta.id);
				if (attached.has(meta.id)) continue;
				const state = cache.sessions[meta.id] ?? createUsageState();
				const revision = revisionOf.get(meta.id);
				const changed = state.kind !== "persisted" || (revision !== void 0 && revision !== state.revision) || revision === void 0;
				if (changed) {
					try {
						const wasPersisted = state.kind === "persisted";
						const fromSeq = wasPersisted ? state.consumed : 0;
						const { events } = await persistence.readFrom(meta.id, fromSeq);
						if (!wasPersisted) {
							state.days = new Map();
							state.lastSample = null;
							state.currentModel = null;
							state.consumed = 0;
						}
						const fresh = wasPersisted ? events.filter((event) => event.seq > (state.consumed ?? 0)) : events;
						const contiguous = fresh.length === 0 ? state.consumed === 0 : fresh[0].seq === state.consumed + 1;
						if (!contiguous && state.consumed > 0) {
							state.days = new Map();
							state.lastSample = null;
							state.currentModel = null;
							state.consumed = 0;
							const { events: allEvents } = await persistence.readFrom(meta.id, 0);
							applyUsageDelta(state, allEvents);
							state.consumed = allEvents.length > 0 ? allEvents[allEvents.length - 1].seq : 0;
						} else if (fresh.length > 0) {
							applyUsageDelta(state, fresh);
							state.consumed = fresh[fresh.length - 1].seq;
						}
						state.kind = "persisted";
						if (revision !== void 0) state.revision = revision;
						dirty = true;
					} catch (error) {
						ctx.logger.warn(`usage-calendar: reading persisted session "${meta.id}" failed: ${String(error)}`);
					}
				}
				cache.sessions[meta.id] = state;
			}
		}
		for (const id of Object.keys(cache.sessions)) {
			if (!attached.has(id) && !persistedIds.has(id)) {
				delete cache.sessions[id];
				dirty = true;
			}
		}
		const byDay = new Map();
		for (const state of Object.values(cache.sessions)) mergeInto(byDay, state.days);
		// Throttled persistence: the client polls every second, but the cache
		// is only written when something changed and at most every 10 seconds.
		if (dirty) cacheDirty = true;
		if (cacheDirty && Date.now() - lastSaveAt >= CACHE_SAVE_MIN_MS) {
			await saveCache(ctx, cache);
			cacheDirty = false;
			lastSaveAt = Date.now();
		}
		return renderUsage(byDay, Date.now());
	});
}

async function handleUsage(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const result = await collectUsage(ctx);
		json(res, 200, { ok: true, ...result });
	} catch (error) {
		ctx.logger.warn(`usage-calendar: usage aggregation failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

//#region balance
let balanceCache = { at: 0, value: null };

/**
 * Query the DeepSeek balance endpoint with Node's global fetch. Provider
 * facts come from the `llm-deepseek` settings namespace (apiKeyEnv,
 * baseURL) with official defaults; the key itself is resolved through the
 * credentials seam at call time.
 */
export async function queryBalance(ctx) {
	const settings = ctx.get("settings");
	const conf = settings?.get?.("llm-deepseek");
	const apiKeyEnv =
		conf !== null && conf !== void 0 && typeof conf.apiKeyEnv === "string" && conf.apiKeyEnv.length > 0
			? conf.apiKeyEnv
			: DEEPSEEK_DEFAULTS.apiKeyEnv;
	const baseURL =
		conf !== null && conf !== void 0 && typeof conf.baseURL === "string" && conf.baseURL.length > 0
			? conf.baseURL
			: DEEPSEEK_DEFAULTS.baseURL;
	const credentials = ctx.get("credentials") ?? ctx.credentials;
	const hit = await credentials.resolve(apiKeyEnv);
	if (hit === void 0 || hit.value === void 0 || hit.value === "") {
		const error = new Error(`no credential configured for ${apiKeyEnv}`);
		error.code = "no-credential";
		throw error;
	}
	const response = await fetch(new URL("/user/balance", baseURL).href, {
		headers: { authorization: `Bearer ${hit.value}` },
		signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
	});
	if (!response.ok) {
		const error = new Error(`balance API returned HTTP ${response.status}`);
		error.httpStatus = response.status;
		throw error;
	}
	const body = await response.json();
	const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
	const info = infos.find((entry) => entry?.currency === "CNY") ?? infos[0];
	const asNumber = (value) => {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	};
	return {
		isAvailable: body?.is_available === true,
		currency: info?.currency !== void 0 ? String(info.currency) : "USD",
		total: asNumber(info?.total_balance),
		granted: asNumber(info?.granted_balance),
		toppedUp: asNumber(info?.topped_up_balance)
	};
}

/** Cached balance access; `force` bypasses the 60-second memory cache. */
async function getBalance(ctx, force) {
	if (!force && balanceCache.value !== null && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value;
	try {
		const balance = await queryBalance(ctx);
		const result = { ok: true, balance, fetchedAt: Date.now() };
		balanceCache = { at: Date.now(), value: result };
		return result;
	} catch (error) {
		const code = error?.code === "no-credential" ? "no-credential" : "failed";
		return { ok: false, error: code, message: error instanceof Error ? error.message : String(error) };
	}
}

async function handleBalance(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const url = new URL(req.url ?? "/", "http://x");
		const result = await getBalance(ctx, url.searchParams.get("refresh") === "1");
		if (result.ok) json(res, 200, result);
		else if (result.error === "no-credential") json(res, 200, { ok: false, error: "no-credential", message: result.message });
		else json(res, 502, result);
	} catch (error) {
		ctx.logger.warn(`usage-calendar: balance fetch failed: ${String(error)}`);
		json(res, 502, { ok: false, error: "failed", message: error instanceof Error ? error.message : String(error) });
	}
}
//#endregion

/** Start an immediate refresh and repeat account + usage refresh every 5 minutes. */
function startBackgroundRefresh(ctx) {
	let running = false;
	let stopped = false;
	let active = Promise.resolve();
	const run = async () => {
		if (running || stopped) return active;
		running = true;
		active = (async () => {
			const results = await Promise.allSettled([getBalance(ctx, true), collectUsage(ctx)]);
			for (const result of results) {
				if (result.status === "rejected") ctx.logger.warn(`usage-calendar: background refresh failed: ${String(result.reason)}`);
			}
		})().finally(() => {
			running = false;
		});
		return active;
	};
	void run();
	const timer = setInterval(run, REFRESH_INTERVAL_MS);
	timer?.unref?.();
	const stop = async () => {
		stopped = true;
		clearInterval(timer);
		await active;
	};
	return stop;
}

const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-usage-calendar",
		validate(value) {
			return { value: value ?? {} };
		}
	}
};

/**
 * Plugin body: register the two exact routes and start background refresh.
 * @param ctx - plugin context carrying webServer, credentials, sessions, sessionPersistence, and settings.
 */
async function apply(ctx) {
	ctx.effect(
		() => ctx.webServer.register({ kind: "exact", path: USAGE_PATH, handler: (req, res) => handleUsage(ctx, req, res) }),
		"usage-calendar: usage route"
	);
	ctx.effect(
		() => ctx.webServer.register({ kind: "exact", path: BALANCE_PATH, handler: (req, res) => handleBalance(ctx, req, res) }),
		"usage-calendar: balance route"
	);
	ctx.effect(() => startBackgroundRefresh(ctx), "usage-calendar: background refresh");
}

export { apply, Config, inject, name, USAGE_PATH, BALANCE_PATH };
