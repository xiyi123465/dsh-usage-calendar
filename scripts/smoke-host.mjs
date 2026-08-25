/**
 * dsh-usage-calendar — host smoke test with stubbed services.
 *
 * Runs the fold engine against synthetic events, then boots the plugin
 * against a fake context whose services are stubbed (no network, no real
 * session store). Point DSH_HOME at a temp directory so the usage cache
 * write does not touch the real one.
 *
 *   node scripts/smoke-host.mjs
 */

import { apply, collectUsage } from "../lib/index.js";
import { foldUsage, renderUsage, zeroBuckets } from "../lib/usage.js";

// ---- 1. fold engine against synthetic events ----
const base = Date.parse("2026-07-20T10:00:00+08:00");
const events = [
	{
		seq: 1,
		type: "request/header",
		time: base,
		data: { header: { config: { provider: "deepseek-official", model: "deepseek-chat" } } }
	},
	{
		seq: 2,
		type: "assistant/chunk",
		time: base + 1000,
		data: {
			turn: 1,
			step: 1,
			chunk: {
				type: "usage",
				usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 0 }
			}
		}
	},
	{
		seq: 3,
		type: "assistant/message",
		time: base + 2000,
		data: {
			turn: 1,
			step: 1,
			usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 0 },
			message: { source: { provider: "deepseek-official", model: "deepseek-chat" } }
		}
	}
];
const folded = foldUsage(events);
const rendered = renderUsage(folded, base + 9999);
if (rendered.days.length !== 1) throw new Error(`expected 1 day, got ${rendered.days.length}`);
const day = rendered.days[0];
if (day.tokens !== 550) throw new Error(`expected 550 tokens, got ${day.tokens}`);
if (day.samples !== 1) throw new Error(`expected 1 sample (replace semantics), got ${day.samples}`);
if (day.cacheHitRate !== 80) throw new Error(`expected 80% cache hit, got ${day.cacheHitRate}`);
if (!(day.spendUsd > 0)) throw new Error(`expected positive spend, got ${day.spendUsd}`);
if (day.models.length !== 1) throw new Error(`expected 1 model row, got ${day.models.length}`);
if (day.models[0].model !== "deepseek-official/deepseek-chat") throw new Error(`unexpected model key ${day.models[0].model}`);
console.log("fold engine OK:", JSON.stringify(day));

// ---- 2. plugin boot against stubbed services ----
globalThis.fetch = async (url) => {
	console.log("stub fetch:", String(url).slice(0, 60));
	return new Response(
		JSON.stringify({
			is_available: true,
			balance_infos: [{ currency: "CNY", total_balance: "79.47", granted_balance: "0.00", topped_up_balance: "79.47" }]
		}),
		{ status: 200 }
	);
};

const routes = [];
const fakeCtx = {
	webServer: {
		register(route) {
			routes.push(route);
			return () => {};
		}
	},
	get(name) {
		if (name === "webServer") {
			return fakeCtx.webServer;
		}
		if (name === "credentials") {
			return {
				async resolve() {
					return { value: "sk-test", source: "test" };
				}
			};
		}
		if (name === "sessions") {
			return { list() { return []; } };
		}
		if (name === "sessionPersistence") {
			return {
				async list() { return []; },
				async listSnapshots() { return []; }
			};
		}
		if (name === "settings") {
			return { get() { return undefined; } };
		}
		return undefined;
	},
	effect(fn) {
		return fn();
	},
	logger: console
};

await apply(fakeCtx, {});
const paths = routes.map((r) => r.path);
console.log("routes:", paths.join(", "));
if (!paths.includes("/api/usage-calendar/usage")) throw new Error("usage route missing");
if (!paths.includes("/api/usage-calendar/balance")) throw new Error("balance route missing");

const usage = await collectUsage(fakeCtx);
if (!Array.isArray(usage.days) || usage.days.length !== 0) throw new Error("empty-session collectUsage should return zero days");
console.log("collectUsage OK (empty sessions)");

// ---- 3. exercise the balance handler through the stub server ----
const balanceRoute = routes.find((r) => r.path === "/api/usage-calendar/balance");
let captured = null;
const fakeRes = {
	writeHead(status, headers) {
		captured = { status, headers };
	},
	end(body) {
		captured.body = body;
	}
};
await balanceRoute.handler({ method: "GET", url: "/api/usage-calendar/balance?refresh=1", headers: { host: "localhost" }, socket: { remoteAddress: "127.0.0.1" } }, fakeRes);
const parsed = JSON.parse(captured.body);
if (!parsed.ok || parsed.balance.currency !== "CNY" || parsed.balance.total !== 79.47) {
	throw new Error(`unexpected balance response: ${captured.body}`);
}
console.log("balance handler OK:", captured.body);

console.log("SMOKE OK");
