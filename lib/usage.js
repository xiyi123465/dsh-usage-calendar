/**
 * dsh-usage-calendar — pure per-day, per-model token-usage aggregation over
 * session event logs, plus DeepSeek-pricing-based spend estimation.
 *
 * Aggregation semantics mirror the harness token-usage projection: a usage
 * sample rides an `assistant/chunk` (`data.chunk.type === "usage"`) or an
 * `assistant/message` (`data.usage`); a repeated sample for the same
 * (turn, step) REPLACES the earlier value instead of double counting it.
 * Models are attributed via `assistant/message` `data.message.source` or the
 * last `request/header` `data.header.config`.
 *
 * @module dsh-usage-calendar/usage
 */

/** Local-calendar `YYYY-MM-DD` key for a millisecond epoch. */
export function dayKey(timeMs) {
	const date = new Date(timeMs);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Empty token bucket. */
export function zeroBuckets() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0
	};
}

function num(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Provider usage → buckets (missing fields default to 0). */
export function bucketsOf(usage) {
	return {
		inputTokens: num(usage?.inputTokens),
		outputTokens: num(usage?.outputTokens),
		cacheReadTokens: num(usage?.cacheReadTokens),
		cacheWriteTokens: num(usage?.cacheWriteTokens),
		reasoningTokens: num(usage?.reasoningTokens)
	};
}

/** Total tokens across all buckets. */
export function totalTokens(buckets) {
	return buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.reasoningTokens;
}

/**
 * Prompt-side cache hit rate in percent (0–100, one decimal), or null when
 * no prompt tokens were reported. Hits over the whole prompt side:
 * cacheRead / (input + cacheRead + cacheWrite).
 */
export function cacheHitRate(buckets) {
	const prompt = buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
	if (prompt <= 0) return null;
	return Math.round((buckets.cacheReadTokens / prompt) * 1000) / 10;
}

/** Public DeepSeek list prices, USD per million tokens (approximate). */
export const PRICING = {
	default: { hit: 0.028, miss: 0.28, out: 0.42 },
	reasoner: { hit: 0.14, miss: 0.55, out: 2.19 }
};

/** Pick a pricing row for a `provider/model` key. */
export function pricingFor(modelKey) {
	const m = String(modelKey ?? "").toLowerCase();
	if (m.includes("reasoner") || m.includes("r1")) return PRICING.reasoner;
	return PRICING.default;
}

/** Estimated spend in USD for one bucket set under one model key. */
export function spendUsdOf(buckets, modelKey) {
	const p = pricingFor(modelKey);
	return (
		(buckets.inputTokens + buckets.cacheWriteTokens) * p.miss +
		buckets.cacheReadTokens * p.hit +
		buckets.outputTokens * p.out
	) / 1e6;
}

function addInto(target, source) {
	target.inputTokens += source.inputTokens;
	target.outputTokens += source.outputTokens;
	target.cacheReadTokens += source.cacheReadTokens;
	target.cacheWriteTokens += source.cacheWriteTokens;
	target.reasoningTokens += source.reasoningTokens;
	return target;
}

function subtractFrom(target, source) {
	target.inputTokens -= source.inputTokens;
	target.outputTokens -= source.outputTokens;
	target.cacheReadTokens -= source.cacheReadTokens;
	target.cacheWriteTokens -= source.cacheWriteTokens;
	target.reasoningTokens -= source.reasoningTokens;
	return target;
}

/** Extract the usage sample an event carries, if any. */
function sampleOf(event) {
	if (event.type === "assistant/chunk" && event.data?.chunk?.type === "usage") {
		return {
			key: `${event.data.turn}:${event.data.step}`,
			usage: event.data.chunk.usage
		};
	}
	if (event.type === "assistant/message" && event.data?.usage !== void 0) {
		return {
			key: `${event.data.turn}:${event.data.step}`,
			usage: event.data.usage
		};
	}
	return void 0;
}

/** `provider/model` attribution of an event, or undefined. */
function modelOf(event) {
	const source = event.data?.message?.source;
	if (source !== void 0 && typeof source.model === "string") {
		return `${typeof source.provider === "string" && source.provider.length > 0 ? source.provider : "unknown"}/${source.model}`;
	}
	const config = event.data?.header?.config;
	if (config !== void 0 && typeof config.model === "string") {
		return `${typeof config.provider === "string" && config.provider.length > 0 ? config.provider : "unknown"}/${config.model}`;
	}
	return void 0;
}

/** Day entry: totals plus a per-model bucket map and a sample counter. */
function entryOf(byDay, day) {
	let entry = byDay.get(day);
	if (entry === void 0) {
		entry = {
			totals: zeroBuckets(),
			samples: 0,
			models: new Map()
		};
		byDay.set(day, entry);
	}
	return entry;
}

/** One session's incremental fold state. */
export function createUsageState() {
	return {
		days: new Map(),
		lastSample: null,
		currentModel: null,
		consumed: 0
	};
}

/**
 * Fold a slice of NEW events onto an existing session state (mutating).
 * Replacements for the same (turn, step) subtract the previous sample's
 * buckets so a slice starting mid-step stays exact.
 */
export function applyUsageDelta(state, events) {
	let last = state.lastSample;
	let currentModel = state.currentModel;
	for (const event of events) {
		if (event.type === "request/header") {
			const model = modelOf(event);
			if (model !== void 0) currentModel = model;
		}
		const sample = sampleOf(event);
		if (sample === void 0) continue;
		const buckets = bucketsOf(sample.usage);
		const model = modelOf(event) ?? currentModel ?? "unknown/unknown";
		const day = dayKey(event.time);
		const entry = entryOf(state.days, day);
		const replaced = last !== null && last.key === sample.key;
		if (replaced) {
			const previous = state.days.get(last.day);
			if (previous !== void 0) {
				subtractFrom(previous.totals, last.buckets);
				const previousModel = previous.models.get(last.model);
				if (previousModel !== void 0) subtractFrom(previousModel, last.buckets);
			}
		} else {
			entry.samples += 1;
		}
		addInto(entry.totals, buckets);
		let modelBucket = entry.models.get(model);
		if (modelBucket === void 0) {
			modelBucket = zeroBuckets();
			entry.models.set(model, modelBucket);
		}
		addInto(modelBucket, buckets);
		last = { key: sample.key, day, model, buckets };
	}
	state.lastSample = last;
	state.currentModel = currentModel;
}

/** Fold one session's events into per-day, per-model buckets. */
export function foldUsage(events) {
	const state = createUsageState();
	applyUsageDelta(state, events);
	return state.days;
}

/** Merge one session's folded days into a global per-day map. */
export function mergeInto(byDay, sessionDays) {
	for (const [day, entry] of sessionDays) {
		const target = entryOf(byDay, day);
		addInto(target.totals, entry.totals);
		target.samples += entry.samples;
		for (const [model, buckets] of entry.models) {
			let modelBucket = target.models.get(model);
			if (modelBucket === void 0) {
				modelBucket = zeroBuckets();
				target.models.set(model, modelBucket);
			}
			addInto(modelBucket, buckets);
		}
	}
}

/**
 * Render a global per-day map into the wire shape for the usage endpoint.
 * Each day carries totals, a sample count, `tokens`, `cacheHitRate`,
 * `spendUsd` (estimated), and per-model rows.
 */
export function renderUsage(byDay, updatedAt) {
	const days = [...byDay.entries()]
		.map(([date, entry]) => {
			const models = [...entry.models.entries()]
				.map(([model, buckets]) => ({
					model,
					...buckets,
					tokens: totalTokens(buckets),
					cacheHitRate: cacheHitRate(buckets),
					spendUsd: spendUsdOf(buckets, model)
				}))
				.filter((entry) => entry.tokens > 0)
				.sort((a, b) => b.tokens - a.tokens);
			return {
				date,
				...entry.totals,
				samples: entry.samples,
				tokens: totalTokens(entry.totals),
				cacheHitRate: cacheHitRate(entry.totals),
				spendUsd: models.reduce((sum, entry) => sum + entry.spendUsd, 0),
				models
			};
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const total = zeroBuckets();
	let totalSamples = 0;
	for (const [, entry] of byDay) {
		addInto(total, entry.totals);
		totalSamples += entry.samples;
	}
	return {
		days,
		total: {
			...total,
			samples: totalSamples,
			tokens: totalTokens(total),
			cacheHitRate: cacheHitRate(total)
		},
		updatedAt
	};
}
