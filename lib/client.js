/**
 * dsh-usage-calendar — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step): a sidebar footer
 * badge that always shows the DeepSeek account balance, and a floating
 * calendar panel with per-day spend (estimated), token usage, cache hit
 * rate, and per-model breakdowns. Data comes from the server half's
 * loopback-only endpoints via same-origin fetch.
 */
window.__ModuleLoader__.load({
	id: "dsh-usage-calendar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		//#region css
		const css = [
			".ucal_badge{align-items:center;width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}",
			".ucal_badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".ucal_badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}",
			".ucal_badgeAmount{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none;font-size:12px;font-weight:600;line-height:16px;text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
			".ucal_panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));width:352px;max-width:calc(100vw - 24px);max-height:74vh;overflow:auto;box-shadow:var(--dsw-shadow-lv2);border-radius:12px;display:flex;flex-direction:column;position:fixed;right:16px;bottom:16px;font-size:12px;color:var(--dsw-alias-label-primary);user-select:none;-webkit-user-select:none}",
			".ucal_header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex;gap:6px;cursor:grab;touch-action:none}",
			".ucal_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;flex:0 0 auto}",
			".ucal_balance{font-size:15px;font-weight:700;color:var(--dsw-alias-brand-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".ucal_balanceErr{color:var(--dsw-alias-state-error-primary);flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".ucal_btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);padding:2px 8px;font-size:11px;cursor:pointer;line-height:16px;flex:0 0 auto;font-family:inherit}",
			".ucal_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".ucal_btn:disabled{opacity:.5;cursor:default}",
			".ucal_today{display:flex;gap:10px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}",
			".ucal_calhead{display:flex;align-items:center;gap:6px;padding:8px 12px 4px}",
			".ucal_month{flex:1;text-align:center;font-weight:600}",
			".ucal_dowRow{display:grid;grid-template-columns:repeat(7,1fr);padding:0 10px}",
			".ucal_dow{text-align:center;font-size:10px;color:var(--dsw-alias-label-tertiary);padding:2px 0}",
			".ucal_grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;padding:4px 10px 8px}",
			".ucal_cell{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;min-height:56px;padding:2px 4px;cursor:pointer;overflow:hidden}",
			".ucal_cell:hover{border-color:var(--dsw-alias-brand-primary)}",
			".ucal_cellToday{border-color:var(--dsw-alias-brand-primary)}",
			".ucal_cellSelected{box-shadow:0 0 0 2px var(--dsw-alias-label-primary)}",
			".ucal_cellEmpty{opacity:.3;cursor:default}",
			".ucal_cellDay{text-align:right;font-size:10px;color:var(--dsw-alias-label-secondary);line-height:14px}",
			".ucal_cellSpend{font-weight:600;font-size:10px;line-height:13px}",
			".ucal_cellTok{font-size:9px;color:var(--dsw-alias-label-secondary);line-height:12px}",
			".ucal_cellHit{font-size:9px;color:var(--dsw-alias-state-success-primary);line-height:12px}",
			".ucal_detail{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px;max-height:140px;overflow:auto}",
			".ucal_detailTitle{font-weight:600;margin-bottom:4px;cursor:pointer}",
			".ucal_kv{display:flex;gap:10px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}",
			".ucal_models{margin-top:6px;display:flex;flex-direction:column}",
			".ucal_modelRow{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:2px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}",
			".ucal_modelName{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".ucal_foot{padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);display:flex;justify-content:space-between;gap:8px;font-size:10px}",
			".ucal_pill{width:auto;min-width:130px;display:flex;gap:8px;align-items:center;padding:8px 14px;cursor:grab;touch-action:none;font-weight:700;font-size:13px;color:var(--dsw-alias-brand-primary)}",
			".ucal_pillMore{color:var(--dsw-alias-label-secondary);font-size:11px}"
		];
		const STYLE_ID = "dsh-usage-calendar-css";
		(function installCss() {
			let el = document.getElementById(STYLE_ID);
			if (el === null) {
				el = document.createElement("style");
				el.id = STYLE_ID;
				document.head.appendChild(el);
			}
			el.textContent = css.join("\n");
		})();
		//#endregion

		const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
		const CNY_RATE = 7.1;
		const pad2 = (n) => (n < 10 ? "0" + n : String(n));
		const dayKey = (y, m, d) => y + "-" + pad2(m + 1) + "-" + pad2(d);
		const fmtTok = (n) => {
			if (!Number.isFinite(n)) return "—";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1000) return (n / 1000).toFixed(1) + "k";
			return String(Math.round(n));
		};
		const fmtMoney = (n) => {
			if (!Number.isFinite(n)) return "—";
			return n.toFixed(Math.abs(n) < 0.01 && n !== 0 ? 4 : 2);
		};

		let dragState = null;
		let dragWasMoved = false;

		/**
		 * Sidebar footer action: balance badge + floating calendar panel.
		 */
		function UsageCalendarPanel() {
			const [open, setOpen] = react.useState(false);
			const [balance, setBalance] = react.useState(null);
			const [usage, setUsage] = react.useState(null);
			const [month, setMonth] = react.useState(() => {
				const d = new Date();
				return { y: d.getFullYear(), m: d.getMonth() };
			});
			const [selected, setSelected] = react.useState(null);
			const [collapsed, setCollapsed] = react.useState(false);
			const [refreshing, setRefreshing] = react.useState(false);
			const [pos, setPos] = react.useState(null);

			const loadUsage = async () => {
				try {
					const response = await fetch("/api/usage-calendar/usage", { cache: "no-store" });
					const data = await response.json();
					if (data && data.ok) setUsage(data);
				} catch (error) {
					/* keep last data */
				}
			};
			const loadBalance = async (force) => {
				try {
					const response = await fetch("/api/usage-calendar/balance" + (force ? "?refresh=1" : ""), { cache: "no-store" });
					const data = await response.json();
					if (data && data.ok) setBalance(data.balance);
					else setBalance({ error: (data && data.message) || (data && data.error) || "查询失败" });
				} catch (error) {
					setBalance({ error: error instanceof Error ? error.message : String(error) });
				}
			};

			// Balance polling keeps the badge live even while the panel is closed.
			react.useEffect(() => {
				void loadBalance(false);
				const timer = window.setInterval(() => {
					void loadBalance(false);
				}, 1000);
				return () => window.clearInterval(timer);
			}, []);

			react.useEffect(() => {
				if (!open) return;
				void loadUsage();
				const timer = window.setInterval(() => {
					void loadUsage();
				}, 1000);
				const onDown = (event) => {
					const target = event.target;
					if (target && typeof target.closest === "function" && target.closest("[data-ucal-root]") === null) setOpen(false);
				};
				document.addEventListener("mousedown", onDown);
				return () => {
					window.clearInterval(timer);
					document.removeEventListener("mousedown", onDown);
				};
			}, [open]);

			const refresh = () => {
				if (refreshing) return;
				setRefreshing(true);
				void loadBalance(true).finally(() => {
					setRefreshing(false);
					void loadUsage();
				});
			};

			const currency = balance && !balance.error && typeof balance.currency === "string" ? balance.currency : "CNY";
			const symbol = currency === "CNY" ? "¥" : "$";
			const rate = currency === "CNY" ? CNY_RATE : 1;
			const conv = (usd) => usd * rate;

			const badgeText =
				balance && balance.error ? "⚠ 查询失败" : balance ? symbol + fmtMoney(balance.total) : "余额 …";

			const badge = react.createElement(
				"button",
				{
					type: "button",
					className: "ucal_badge",
					"data-active": open ? "" : void 0,
					"data-ucal-root": "badge",
					title: "用量与余额日历",
					onClick: () => setOpen(!open)
				},
				react.createElement("span", { className: "ucal_badgeAmount" }, "💰 " + badgeText)
			);

			if (!open) return badge;

			const today = new Date();
			const todayKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());
			const days = usage && Array.isArray(usage.days) ? usage.days : [];
			const dayMap = {};
			for (const entry of days) dayMap[entry.date] = entry;

			const todayDay = dayMap[todayKey];

			// Month grid (Monday-first).
			const cells = [];
			const first = new Date(month.y, month.m, 1);
			const startDow = (first.getDay() + 6) % 7;
			const dim = new Date(month.y, month.m + 1, 0).getDate();
			for (let i = 0; i < startDow; i++) cells.push(null);
			for (let d = 1; d <= dim; d++) cells.push({ key: dayKey(month.y, month.m, d), d });
			while (cells.length % 7 !== 0) cells.push(null);

			const cellEls = cells.map((cell, i) => {
				if (!cell) return react.createElement("div", { key: "e" + i, className: "ucal_cell ucal_cellEmpty" });
				const day = dayMap[cell.key];
				const cls =
					"ucal_cell" +
					(cell.key === todayKey ? " ucal_cellToday" : "") +
					(cell.key === selected ? " ucal_cellSelected" : "");
				const bg = day
					? { backgroundColor: "rgba(31,111,235," + Math.min(0.3, 0.05 + day.spendUsd * 60).toFixed(3) + ")" }
					: null;
				let inner = null;
				if (day) {
					inner = [
						react.createElement("div", { key: "s", className: "ucal_cellSpend" }, symbol + fmtMoney(conv(day.spendUsd))),
						react.createElement("div", { key: "t", className: "ucal_cellTok" }, fmtTok(day.tokens) + " tok"),
						react.createElement(
							"div",
							{ key: "c", className: "ucal_cellHit" },
							day.cacheHitRate === null ? "—" : "命中 " + day.cacheHitRate + "%"
						)
					];
				}
				return react.createElement(
					"div",
					{
						key: cell.key,
						className: cls,
						style: bg,
						onClick: () => setSelected(selected === cell.key ? null : cell.key)
					},
					react.createElement("div", { className: "ucal_cellDay" }, cell.d),
					inner
				);
			});

			// Month totals.
			const prefix = month.y + "-" + pad2(month.m + 1);
			let mTok = 0,
				mSpend = 0,
				mIn = 0,
				mRead = 0,
				mWrite = 0,
				mSamples = 0;
			for (const entry of days) {
				if (entry.date.slice(0, 7) !== prefix) continue;
				mTok += entry.tokens;
				mSpend += entry.spendUsd;
				mIn += entry.inputTokens;
				mRead += entry.cacheReadTokens;
				mWrite += entry.cacheWriteTokens;
				mSamples += entry.samples;
			}
			const mPrompt = mIn + mRead + mWrite;
			const mHit = mPrompt > 0 ? Math.round((mRead / mPrompt) * 1000) / 10 : null;

			// Selected-day detail.
			const selDay = selected ? dayMap[selected] : null;
			let detailEl = null;
			if (selDay) {
				const rows = (selDay.models || []).map((mm) =>
					react.createElement(
						"div",
						{ key: mm.model, className: "ucal_modelRow" },
						react.createElement("span", { className: "ucal_modelName", title: mm.model }, mm.model),
						react.createElement("span", null, fmtTok(mm.tokens) + " tok"),
						react.createElement("span", null, mm.cacheHitRate === null ? "命中 —" : "命中 " + mm.cacheHitRate + "%"),
						react.createElement("span", null, symbol + fmtMoney(conv(mm.spendUsd)))
					)
				);
				detailEl = react.createElement(
					"div",
					{ className: "ucal_detail" },
					react.createElement(
						"div",
						{ className: "ucal_detailTitle", onClick: () => setSelected(null) },
						selected + " ✕"
					),
					react.createElement(
						"div",
						{ className: "ucal_kv" },
						react.createElement("span", null, "调用 " + selDay.samples + " 步"),
						react.createElement("span", null, "tokens " + fmtTok(selDay.tokens)),
						react.createElement("span", null, "输入 " + fmtTok(selDay.inputTokens) + " · 输出 " + fmtTok(selDay.outputTokens)),
						react.createElement("span", null, "缓存读 " + fmtTok(selDay.cacheReadTokens) + " · 写 " + fmtTok(selDay.cacheWriteTokens)),
						react.createElement("span", null, "命中率 " + (selDay.cacheHitRate === null ? "—" : selDay.cacheHitRate + "%")),
						react.createElement("span", null, "花费 ≈" + symbol + fmtMoney(conv(selDay.spendUsd)))
					),
					rows.length > 0 ? react.createElement("div", { className: "ucal_models" }, rows) : null
				);
			}

			const onDown = (event) => {
				// Never start a drag from a button: pointer capture would swallow
				// the button's click event.
				const target = event.target;
				if (target && typeof target.closest === "function" && target.closest("button") !== null) return;
				const rect = event.currentTarget.getBoundingClientRect();
				dragState = {
					dx: event.clientX - rect.left,
					dy: event.clientY - rect.top,
					startX: event.clientX,
					startY: event.clientY,
					moved: false
				};
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch (err) {
					/* ignore */
				}
			};
			const onMove = (event) => {
				if (!dragState) return;
				if (!dragState.moved && Math.abs(event.clientX - dragState.startX) + Math.abs(event.clientY - dragState.startY) > 3) {
					dragState.moved = true;
				}
				if (dragState.moved) {
					setPos({ x: Math.max(8, event.clientX - dragState.dx), y: Math.max(8, event.clientY - dragState.dy) });
				}
			};
			const onUp = () => {
				dragWasMoved = dragState ? dragState.moved : false;
				dragState = null;
			};

			const posStyle = pos ? { left: pos.x + "px", top: pos.y + "px", right: "auto", bottom: "auto" } : null;

			if (collapsed) {
				return react.createElement(
					"div",
					{ "data-ucal-root": "panel" },
					badge,
					react.createElement(
						"div",
						{
							className: "ucal_panel ucal_pill",
							style: posStyle,
							onPointerDown: onDown,
							onPointerMove: onMove,
							onPointerUp: onUp,
							onPointerCancel: onUp,
							onClick: () => {
								// A real drag must not re-expand the panel.
								if (dragWasMoved) {
									dragWasMoved = false;
									return;
								}
								setCollapsed(false);
							}
						},
						react.createElement(
							"span",
							null,
							"💰 " + (balance && !balance.error ? symbol + fmtMoney(balance.total) : balance && balance.error ? "⚠" : "…")
						),
						react.createElement("span", { className: "ucal_pillMore" }, "展开 ▴")
					)
				);
			}

			const balEl =
				balance && balance.error
					? react.createElement("span", { className: "ucal_balanceErr", title: balance.error }, "⚠ " + balance.error)
					: react.createElement(
							"span",
							{
								className: "ucal_balance",
								title: balance
									? "赠送 " + symbol + fmtMoney(balance.granted) + " · 充值 " + symbol + fmtMoney(balance.toppedUp)
									: ""
							},
							"💰 " + (balance ? symbol + fmtMoney(balance.total) : "获取中…")
						);

			return react.createElement(
				"div",
				{ "data-ucal-root": "panel" },
				badge,
				react.createElement(
					"div",
					{ className: "ucal_panel", style: posStyle },
					react.createElement(
						"div",
						{
							className: "ucal_header",
							onPointerDown: onDown,
							onPointerMove: onMove,
							onPointerUp: onUp,
							onPointerCancel: onUp
						},
						react.createElement("span", { className: "ucal_title" }, "用量与余额"),
						balEl,
						react.createElement("button", { type: "button", className: "ucal_btn", onClick: refresh, disabled: refreshing }, refreshing ? "…" : "刷新"),
						react.createElement("button", { type: "button", className: "ucal_btn", onClick: () => setCollapsed(true) }, "—"),
						react.createElement("button", { type: "button", className: "ucal_btn", onClick: () => setOpen(false) }, "✕")
					),
					react.createElement(
						"div",
						{ className: "ucal_today" },
						react.createElement(
							"span",
							null,
							"今日 " +
								(todayDay
									? fmtTok(todayDay.tokens) +
										" tok · 命中 " +
										(todayDay.cacheHitRate === null ? "—" : todayDay.cacheHitRate + "%")
									: "暂无")
						),
						react.createElement("span", null, todayDay ? "≈" + symbol + fmtMoney(conv(todayDay.spendUsd)) : "")
					),
					react.createElement(
						"div",
						{ className: "ucal_calhead" },
						react.createElement(
							"button",
							{
								type: "button",
								className: "ucal_btn",
								onClick: () => {
									const m = month.m - 1;
									setMonth(m < 0 ? { y: month.y - 1, m: 11 } : { y: month.y, m });
								}
							},
							"‹"
						),
						react.createElement("span", { className: "ucal_month" }, month.y + "年" + (month.m + 1) + "月"),
						react.createElement(
							"button",
							{
								type: "button",
								className: "ucal_btn",
								onClick: () => {
									const m = month.m + 1;
									setMonth(m > 11 ? { y: month.y + 1, m: 0 } : { y: month.y, m });
								}
							},
							"›"
						),
						react.createElement(
							"button",
							{
								type: "button",
								className: "ucal_btn",
								onClick: () => {
									const d = new Date();
									setMonth({ y: d.getFullYear(), m: d.getMonth() });
									setSelected(todayKey);
								}
							},
							"今天"
						)
					),
					react.createElement("div", { className: "ucal_dowRow" }, WEEK.map((w) => react.createElement("div", { key: w, className: "ucal_dow" }, w))),
					react.createElement("div", { className: "ucal_grid" }, cellEls),
					detailEl,
					react.createElement(
						"div",
						{ className: "ucal_foot" },
						react.createElement(
							"span",
							null,
							"本月 ≈" +
								symbol +
								fmtMoney(conv(mSpend)) +
								" · " +
								fmtTok(mTok) +
								" tok · 命中 " +
								(mHit === null ? "—" : mHit + "%") +
								" · " +
								mSamples +
								" 步"
						),
						react.createElement(
							"span",
							null,
							(usage && usage.updatedAt
								? "更新 " + new Date(usage.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) + " · "
								: "") + "按公开标价估算"
						)
					)
				)
			);
		}

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots"];

		/**
		 * Client plugin body: register the sidebar footer action.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () =>
				ctx.slots.register(
					{
						name: "sidebar.footer.action",
						id: "usage-calendar",
						label: () => "用量与余额",
						order: 20
					},
					UsageCalendarPanel
				)
			);
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.UsageCalendarPanel = UsageCalendarPanel;
		return module.exports;
	}
});
