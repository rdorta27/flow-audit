// SPDX-License-Identifier: MIT
/** M5-08: business hours, the audited period, the raw timestamp text and the monthly scaling. */

import { renderHtml } from "../src/adapters/report/html_renderer.ts";
import { runAudit } from "../src/app/run_audit.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { businessHoursBetween } from "../src/domain/calendar.ts";
import { configFromFile, configToFile } from "../src/domain/data_files.ts";
import type { Activity, BusinessCalendar, ImpactConfig } from "../src/domain/model.ts";
import { detectR01 } from "../src/domain/rules/r01.ts";
import { scanR03 } from "../src/domain/rules/r03.ts";
import { assert, assertEquals } from "./assert.ts";
import { memorySources } from "./memory_sources.ts";
import { attempt, config, HOUR, order, so, T0, world } from "./rules_fixture.ts";

const workweek: BusinessCalendar = { weekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 };
const ms = (iso: string) => Date.parse(iso);

Deno.test("business hours: weekends, nights and holidays do not count", () => {
  const h = (from: string, to: string, c = workweek) => businessHoursBetween(ms(from), ms(to), c);
  // Friday 17:00 to Monday 10:00: one hour on Friday, one on Monday.
  assertEquals(h("2026-09-04T17:00:00Z", "2026-09-07T10:00:00Z"), 2);
  assertEquals(h("2026-09-02T09:00:00Z", "2026-09-02T18:00:00Z"), 9);
  assertEquals(h("2026-09-02T18:00:00Z", "2026-09-03T09:00:00Z"), 0);
  assertEquals(h("2026-09-05T00:00:00Z", "2026-09-06T23:00:00Z"), 0);
  assertEquals(h("2026-09-07T10:00:00Z", "2026-09-04T17:00:00Z"), 0);
  assertEquals(
    h("2026-09-03T00:00:00Z", "2026-09-05T00:00:00Z", { ...workweek, holidays: ["2026-09-04"] }),
    9,
  );
  // Local hours: Madrid is UTC+2 in September, so 09:00 local is 07:00Z; in January UTC+1.
  const madrid = { ...workweek, timeZone: "Europe/Madrid" };
  assertEquals(h("2026-09-02T07:00:00Z", "2026-09-02T16:00:00Z", madrid), 9);
  assertEquals(h("2026-01-14T08:00:00Z", "2026-01-14T17:00:00Z", madrid), 9);
});

const sevenDays = (n: number) => T0 + n * 24 * HOUR;

/** Friday 17:00 failure, retry on Monday 10:00: 65 calendar hours, 2 business hours. */
function weekendWorld() {
  const friday = (sevenDays(3) - T0) / HOUR + 17; // T0 is a Tuesday
  const monday = (sevenDays(6) - T0) / HOUR + 10;
  return world({
    orders: [order("O1"), order("O2")],
    serviceOrders: [so("S1", "O1"), so("S2", "O2")],
    attempts: [
      attempt("A1", "S1", friday),
      attempt("A2", "S1", monday, { state: "succeeded", errorCode: null }),
      attempt("A3", "S2", 1, { state: "succeeded", errorCode: null }),
    ],
  });
}

Deno.test("a retry window in business hours changes R01 on the same data", () => {
  const w = weekendWorld();
  const calendar: ImpactConfig = {
    ...config,
    thresholds: { ...config.thresholds, retryWindowHours: 24 },
  };
  assertEquals(detectR01(w.orders, calendar, { correlation: w })?.affectedOrders, 1);
  const business: ImpactConfig = {
    ...calendar,
    thresholds: { ...calendar.thresholds, retryWindowBasis: "business" },
    calendar: workweek,
  };
  assertEquals(detectR01(w.orders, business, { correlation: w }), null);
});

Deno.test("the calendar is read from config.json and required by a business threshold", () => {
  const file = configToFile({
    ...config,
    thresholds: { ...config.thresholds, retryWindowBasis: "business" },
    calendar: { ...workweek, timeZone: "Europe/Madrid", holidays: ["2026-12-25"] },
  });
  assertEquals((file.thresholds as Record<string, unknown>).retry_window_basis, "business");
  const back = configFromFile(JSON.parse(JSON.stringify(file)));
  assertEquals(back.calendar?.startHour, 9);
  assertEquals(back.calendar?.timeZone, "Europe/Madrid");
  const missing = { ...file };
  delete missing.calendar;
  let message = "";
  try {
    configFromFile(missing);
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes("no calendar"), message);
});

const timer = (extra: Partial<Activity> = {}): Activity => ({
  processId: "P1",
  sequence: 1,
  kind: "timer",
  name: "activation_timer",
  actor: "system",
  startedAt: new Date(T0).toISOString(),
  endedAt: new Date(T0 + 24 * HOUR).toISOString(),
  timerExpired: true,
  ...extra,
});

const r03cfg: ImpactConfig = {
  ...config,
  rules: { r03: { timerActivities: ["activation_timer"], compensationActivities: [] } },
};

function stuckWorld() {
  return world({
    orders: [order("O1")], // the newest intake is T0, before the timer fired
    serviceOrders: [so("S1", "O1")],
    attempts: [],
    processes: [{
      processId: "P1",
      soRef: "S1",
      businessKey: null,
      state: "RUNNING",
      startedAt: new Date(T0).toISOString(),
      endedAt: null,
      activities: [timer()],
    }],
  });
}

Deno.test("R03 ends the days stuck at the declared period end, else at the newest order", () => {
  const w = stuckWorld();
  assertEquals(scanR03(w.orders, r03cfg, { correlation: w }).hits.length, 0);
  const period = {
    start: new Date(T0).toISOString(),
    end: new Date(T0 + 10 * 24 * HOUR).toISOString(),
  };
  const scan = scanR03(w.orders, r03cfg, { correlation: w, period });
  assertEquals(scan.hits.length, 1);
  assertEquals(scan.periodEnd, T0 + 10 * 24 * HOUR);
  assertEquals(Math.round(scan.hits[0].daysStuck! * 100) / 100, 9);
});

Deno.test("R03 stuck_after_hours in business hours", () => {
  const w = stuckWorld();
  // The timer fires Wednesday 2026-09-02 00:00Z; the period ends Thursday 18:00Z: 36 calendar
  // hours later but only 18 business hours (Wednesday and Thursday, 09:00 to 18:00).
  const period = { start: new Date(T0).toISOString(), end: "2026-09-03T18:00:00.000Z" };
  const at = (basis: "calendar" | "business", hours: number): ImpactConfig => ({
    ...r03cfg,
    thresholds: { ...r03cfg.thresholds, stuckAfterHours: hours, stuckAfterBasis: basis },
    calendar: workweek,
  });
  assertEquals(scanR03(w.orders, at("calendar", 30), { correlation: w, period }).hits.length, 1);
  assertEquals(scanR03(w.orders, at("business", 30), { correlation: w, period }).hits.length, 0);
  assertEquals(scanR03(w.orders, at("business", 17), { correlation: w, period }).hits.length, 1);
});

Deno.test("records outside the declared period are removed, counted and shown", async () => {
  const day = (n: number) => new Date(T0 + n * 24 * HOUR).toISOString();
  const result = await runAudit({}, {
    clock: { nowIso: () => "2026-09-01T00:00:00Z" },
    sources: memorySources({
      orders: [
        order("O1", { submittedAt: day(1) }),
        order("O2", { submittedAt: day(2) }),
        order("OLD", { submittedAt: day(-40) }),
      ],
      serviceOrders: [so("S1", "O1"), so("S2", "O2"), so("SOLD", "OLD")],
      attempts: [
        attempt("A1", "S1", 30),
        attempt("A2", "S2", 54, { state: "succeeded", errorCode: null }),
        attempt("AOLD", "SOLD", -900), // a failure that would be fallout, but the order is old
      ],
    }, { period: { start: day(0), end: day(10) } }),
    config: { ...config, ordersPerMonth: 100 },
  });
  const p = result.report.period!;
  assertEquals(p.declared, true);
  assertEquals(p.removed, { orders: 1, serviceOrders: 1, processes: 0, attempts: 1 });
  assertEquals(result.correlation.orders.length, 2);
  assertEquals(result.findings.find((f) => f.id === "R01")?.affectedOrders, 1);
  const s = result.report.scaling!;
  assertEquals([s.ordersInPeriod, s.ordersPerMonth, s.factor], [2, 100, 50]);
  assertEquals(s.periodDays, 10);
  assertEquals(s.observedOrdersPerMonth, 6);
  assert(s.formula.includes("orders_per_month"));
  const html = renderHtml(result.report);
  assert(html.includes("Period audited: 2026-09-01 to 2026-09-11"), "the declared dates");
  assert(html.includes("Removed before the rules ran: 1 orders, 1 service orders"), "removed");
  assert(html.includes("<strong>not rescaled</strong>"), "says the hours were not rescaled");
  assert(html.includes('id="assume-period"'), "the period is a row of the assumptions table");
});

Deno.test("without a declared period the span of the orders is reported", async () => {
  const result = await runAudit({}, {
    clock: { nowIso: () => "2026-09-01T00:00:00Z" },
    sources: memorySources({
      orders: [order("O1")],
      serviceOrders: [so("S1", "O1")],
      attempts: [],
    }),
    config,
  });
  assertEquals(result.report.period?.declared, false);
  assertEquals(result.report.period?.removed.orders, 0);
  const html = renderHtml(result.report);
  assert(html.includes("No period was declared, so this is the span of the order records"), "span");
});

Deno.test("the original timestamp text is kept next to the UTC value", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const m = JSON.parse(await Deno.readTextFile("data/demo/mapping.json"));
    m.oms.date_format = "dd/MM/yyyy HH:mm";
    m.oms.time_zone = "America/Bogota";
    const header = (await Deno.readTextFile("data/demo/oms_orders.csv")).split("\n")[0];
    await Deno.writeTextFile(
      `${dir}/oms_orders.csv`,
      `${header}\nORD-1,01/09/2026 08:30,ACTIVE,OFFER-A,v1,SO-1,SPEC-A,ACTIVE,02/09/2026 09:00,SN-1,,,,,,\n`,
    );
    const sources = createFileSources(parseMapping(JSON.stringify(m), "mapping.json"), {
      dir,
      now: () => "2026-09-30T00:00:00.000Z",
    });
    const rows = [];
    for await (const r of sources.productOrders.read()) rows.push(sources.mappers.order(r));
    assertEquals(rows[0].submittedAt, "2026-09-01T13:30:00.000Z");
    assertEquals(rows[0].submittedAtRaw, "01/09/2026 08:30");
    const sos = [];
    for await (const r of sources.serviceOrders.read()) sos.push(sources.mappers.serviceOrder(r));
    assertEquals(sos[0].createdAtRaw, "02/09/2026 09:00");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a timestamp already in UTC keeps no raw copy", async () => {
  const sources = createFileSources(
    parseMapping(await Deno.readTextFile("data/demo/mapping.json"), "mapping.json"),
    { dir: "data/demo", now: () => "2026-09-30T00:00:00.000Z" },
  );
  for await (const r of sources.productOrders.read()) {
    assertEquals(sources.mappers.order(r).submittedAtRaw, undefined);
    break;
  }
});
