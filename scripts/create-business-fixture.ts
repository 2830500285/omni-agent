import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "omni-business-renewals-"));

mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, "data"), { recursive: true });
mkdirSync(join(root, "test"), { recursive: true });

write("package.json", `{
  "name": "omni-business-renewals-fixture",
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
`);

write("README.md", `# B2B Renewal Billing Fixture

Implement the 2026 renewal policy for enterprise invoices.

Policy:
- Base plan fees are billed in cents from \`PLAN_CATALOG\`.
- Extra seats are prorated by \`activeDays / billingDays\` and rounded to the nearest cent.
- Usage over the included allowance is tiered: the first 10,000 overage units cost 8 cents each, then all remaining overage units cost 5 cents each.
- Promotional discounts are a percentage of subtotal before tax, but the promo percent is capped at 20%.
- Loyalty credits are applied after promotional discount and before tax. Net revenue cannot go below zero.
- US tax rates: CA 8.75%, NY 8.875%, DE 0%.
- EU VAT is 20% unless a VAT id is present, in which case reverse-charge tax is 0.
- \`taxExempt=true\` always means tax is 0.
- Put an invoice on hold when total is above 100,000 cents and payment method is not \`bank_transfer\`.
- Reports must include net revenue, tax, total due, held invoice count, and held invoice ids.
`);

write("data/orders.csv", `id,customer,plan,seats,activeDays,billingDays,usageUnits,country,region,vatId,taxExempt,promoPercent,loyaltyCreditCents,paymentMethod
INV-1001,Acme Robotics,growth,32,20,30,12500,US,CA,,false,15,2500,card
INV-1002,Nordic Labs,enterprise,120,30,30,42000,DE,,DE123456789,false,0,0,bank_transfer
INV-1003,Delaware Nonprofit,starter,8,30,30,900,US,DE,,true,10,500,card
INV-1004,New York Retail,growth,80,15,30,65000,US,NY,,false,25,0,card
`);

write("src/catalog.js", `export const PLAN_CATALOG = {
  starter: {
    baseFeeCents: 12000,
    includedSeats: 10,
    extraSeatCents: 1500,
    includedUsageUnits: 1000,
  },
  growth: {
    baseFeeCents: 45000,
    includedSeats: 25,
    extraSeatCents: 1800,
    includedUsageUnits: 10000,
  },
  enterprise: {
    baseFeeCents: 120000,
    includedSeats: 100,
    extraSeatCents: 1400,
    includedUsageUnits: 50000,
  },
};
`);

write("src/csv.js", `export function parseOrdersCsv(csvText) {
  const [headerLine, ...rows] = csvText.trim().split(/\\r?\\n/);
  const headers = headerLine.split(",");
  return rows.map((row) => {
    const values = row.split(",");
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      ...record,
      seats: Number(record.seats),
      activeDays: Number(record.activeDays),
      billingDays: Number(record.billingDays),
      usageUnits: Number(record.usageUnits),
      taxExempt: record.taxExempt === "true",
      promoPercent: Number(record.promoPercent),
      loyaltyCreditCents: Number(record.loyaltyCreditCents),
    };
  });
}
`);

write("src/pricing.js", `import { PLAN_CATALOG } from "./catalog.js";

export function calculateCharges(order) {
  const plan = PLAN_CATALOG[order.plan];
  if (!plan) {
    throw new Error(\`Unknown plan: \${order.plan}\`);
  }

  const extraSeats = Math.max(0, order.seats - plan.includedSeats);
  const seatChargeCents = extraSeats * plan.extraSeatCents;
  const overageUnits = Math.max(0, order.usageUnits - plan.includedUsageUnits);
  const usageChargeCents = overageUnits * 8;
  const subtotalBeforeDiscountCents = plan.baseFeeCents + seatChargeCents + usageChargeCents;
  const discountCents = Math.round(subtotalBeforeDiscountCents * (order.promoPercent / 100));
  const netRevenueCents = Math.max(0, subtotalBeforeDiscountCents - discountCents);

  return {
    baseFeeCents: plan.baseFeeCents,
    seatChargeCents,
    usageChargeCents,
    subtotalBeforeDiscountCents,
    discountCents,
    loyaltyCreditCents: 0,
    netRevenueCents,
  };
}
`);

write("src/tax.js", `const US_TAX_RATES = {
  CA: 0.0875,
  NY: 0.08875,
  DE: 0,
};

export function calculateTax(order, netRevenueCents) {
  if (order.country === "US") {
    const rate = US_TAX_RATES[order.region] ?? 0;
    return {
      taxCents: Math.round(netRevenueCents * rate),
      taxMode: "us_sales_tax",
    };
  }

  if (order.country === "DE") {
    return {
      taxCents: Math.round(netRevenueCents * 0.2),
      taxMode: "eu_vat",
    };
  }

  return {
    taxCents: 0,
    taxMode: "none",
  };
}
`);

write("src/risk.js", `export function assessRisk(order, totalDueCents) {
  return {
    hold: false,
    flags: [],
  };
}
`);

write("src/report.js", `import { calculateCharges } from "./pricing.js";
import { calculateTax } from "./tax.js";
import { assessRisk } from "./risk.js";

export function buildInvoice(order) {
  const charges = calculateCharges(order);
  const tax = calculateTax(order, charges.netRevenueCents);
  const totalDueCents = charges.netRevenueCents + tax.taxCents;
  const risk = assessRisk(order, totalDueCents);
  return {
    id: order.id,
    customer: order.customer,
    plan: order.plan,
    ...charges,
    ...tax,
    totalDueCents,
    hold: risk.hold,
    riskFlags: risk.flags,
  };
}

export function buildInvoices(orders) {
  return orders.map((order) => buildInvoice(order));
}

export function summarizeInvoices(invoices) {
  return {
    invoiceCount: invoices.length,
    netRevenueCents: invoices.reduce((sum, invoice) => sum + invoice.netRevenueCents, 0),
    taxCents: invoices.reduce((sum, invoice) => sum + invoice.taxCents, 0),
    totalDueCents: invoices.reduce((sum, invoice) => sum + invoice.totalDueCents, 0),
    heldInvoiceCount: 0,
    heldInvoiceIds: [],
  };
}
`);

write("src/index.js", `import { readFileSync } from "node:fs";
import { parseOrdersCsv } from "./csv.js";
import { buildInvoices, summarizeInvoices } from "./report.js";

export function runBillingReport(csvPath = new URL("../data/orders.csv", import.meta.url)) {
  const orders = parseOrdersCsv(readFileSync(csvPath, "utf8"));
  const invoices = buildInvoices(orders);
  return {
    invoices,
    summary: summarizeInvoices(invoices),
  };
}
`);

write("test/business.test.js", `import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseOrdersCsv } from "../src/csv.js";
import { buildInvoices, summarizeInvoices } from "../src/report.js";

const orders = parseOrdersCsv(readFileSync(new URL("../data/orders.csv", import.meta.url), "utf8"));
const invoices = buildInvoices(orders);

test("2026 renewal policy computes exact invoice totals", () => {
  assert.deepEqual(
    invoices.map((invoice) => ({
      id: invoice.id,
      subtotalBeforeDiscountCents: invoice.subtotalBeforeDiscountCents,
      discountCents: invoice.discountCents,
      loyaltyCreditCents: invoice.loyaltyCreditCents,
      netRevenueCents: invoice.netRevenueCents,
      taxCents: invoice.taxCents,
      taxMode: invoice.taxMode,
      totalDueCents: invoice.totalDueCents,
    })),
    [
      {
        id: "INV-1001",
        subtotalBeforeDiscountCents: 73400,
        discountCents: 11010,
        loyaltyCreditCents: 2500,
        netRevenueCents: 59890,
        taxCents: 5240,
        taxMode: "us_sales_tax",
        totalDueCents: 65130,
      },
      {
        id: "INV-1002",
        subtotalBeforeDiscountCents: 148000,
        discountCents: 0,
        loyaltyCreditCents: 0,
        netRevenueCents: 148000,
        taxCents: 0,
        taxMode: "eu_reverse_charge",
        totalDueCents: 148000,
      },
      {
        id: "INV-1003",
        subtotalBeforeDiscountCents: 12000,
        discountCents: 1200,
        loyaltyCreditCents: 500,
        netRevenueCents: 10300,
        taxCents: 0,
        taxMode: "tax_exempt",
        totalDueCents: 10300,
      },
      {
        id: "INV-1004",
        subtotalBeforeDiscountCents: 399500,
        discountCents: 79900,
        loyaltyCreditCents: 0,
        netRevenueCents: 319600,
        taxCents: 28365,
        taxMode: "us_sales_tax",
        totalDueCents: 347965,
      },
    ],
  );
});

test("risk holds high value non-bank-transfer invoices only", () => {
  assert.deepEqual(
    invoices.map((invoice) => ({ id: invoice.id, hold: invoice.hold, riskFlags: invoice.riskFlags })),
    [
      { id: "INV-1001", hold: false, riskFlags: [] },
      { id: "INV-1002", hold: false, riskFlags: [] },
      { id: "INV-1003", hold: false, riskFlags: [] },
      { id: "INV-1004", hold: true, riskFlags: ["manual_review", "high_value_card"] },
    ],
  );
});

test("summary report is finance-ready", () => {
  assert.deepEqual(summarizeInvoices(invoices), {
    invoiceCount: 4,
    netRevenueCents: 537790,
    taxCents: 33605,
    totalDueCents: 571395,
    heldInvoiceCount: 1,
    heldInvoiceIds: ["INV-1004"],
  });
});
`);

console.log(root);

function write(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, "utf8");
}
