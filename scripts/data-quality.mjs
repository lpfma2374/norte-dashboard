#!/usr/bin/env node
/**
 * Data Quality runner (pipeline CI/CD v2) — validação declarativa de dados via API.
 * Zero contas externas: corre com Node puro contra um endpoint read-only.
 *
 * Uso:
 *   DATA_QUALITY_URL=https://api.exemplo.com/api/records \
 *   [DATA_QUALITY_RECORDS_PATH="records[].fields"]  \
 *   [DATA_QUALITY_EXPECTATIONS=data-quality/expectations.json] \
 *   node scripts/data-quality.mjs
 *
 * DATA_QUALITY_RECORDS_PATH resolve o caminho até ao array de registos:
 *   ""                -> a resposta JSON já é um array
 *   "stories"         -> { stories: [...] }
 *   "records"         -> { records: [ { id, fields: {...} } ] } (estilo Airtable/D1)
 *   "records[].fields"-> idem, mas valida os campos diretamente (perde o id do wrapper)
 *
 * Expectativas: array JSON com regras declarativas (todas aceitam "severity":
 * "error" (predefinido) | "warn"):
 *   { "type": "minCount",  "value": 40 }
 *   { "type": "maxCount",  "value": 5000 }
 *   { "type": "nonNull",   "field": "Ref" }
 *   { "type": "unique",    "field": "id" }
 *   { "type": "enum",      "field": "Status", "values": ["A", "B"] }
 *   { "type": "min",       "field": "Price", "value": 0 }   // nulls são ignorados
 *   { "type": "max",       "field": "idade", "value": 60 }  // nulls são ignorados
 *   { "type": "regex",     "field": "id", "pattern": "^rec_[a-z0-9-]+$" }
 *   { "type": "freshness", "field": "date", "maxAgeDays": 365 } // >=1 registo recente
 *
 * Exit 1 se alguma regra "error" falhar; "warn" apenas reporta.
 */
import { readFileSync } from "node:fs";

const API_URL = process.env.DATA_QUALITY_URL;
if (!API_URL) {
  console.error("DATA_QUALITY_URL não definido.");
  process.exit(1);
}
const RECORDS_PATH = process.env.DATA_QUALITY_RECORDS_PATH ?? "";
const EXPECTATIONS_FILE =
  process.env.DATA_QUALITY_EXPECTATIONS ?? "data-quality/expectations.json";

async function main() {
  // Cloudflare bloqueia UAs de biblioteca: usar UA identificável tipo browser.
  const res = await fetch(API_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 data-quality/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    console.error(`API respondeu ${res.status} ${res.statusText} em ${API_URL}`);
    process.exit(1);
  }
  const data = await res.json();

  // Resolver o caminho até ao array de registos.
  let records;
  if (RECORDS_PATH === "") {
    records = Array.isArray(data) ? data : null;
  } else if (RECORDS_PATH.includes("[]")) {
    const [arrPath, itemPath] = RECORDS_PATH.split("[]");
    const arr = arrPath
      ? arrPath.split(".").reduce((o, k) => o?.[k], data)
      : data;
    records = Array.isArray(arr)
      ? itemPath
        ? arr.map((r) =>
            itemPath
              .replace(/^\./, "")
              .split(".")
              .reduce((o, k) => o?.[k], r)
          )
        : arr
      : null;
  } else {
    records = RECORDS_PATH.split(".").reduce((o, k) => o?.[k], data);
  }
  if (!Array.isArray(records)) {
    console.error(
      `DATA_QUALITY_RECORDS_PATH '${RECORDS_PATH}' não resolve para um array.`
    );
    process.exit(1);
  }

  const rules = JSON.parse(readFileSync(EXPECTATIONS_FILE, "utf8"));
  const failures = [];
  const warnings = [];

  const val = (r, f) =>
    f.includes(".")
      ? f.split(".").reduce((o, k) => o?.[k], r)
      : r?.[f];
  // devolve {n: total de violações, bad: amostra de 5}
  const violations = (fn) => {
    const bad = [];
    let n = 0;
    for (const r of records) {
      if (fn(r)) {
        n += 1;
        if (bad.length < 5) bad.push(r);
      }
    }
    return { n, bad };
  };
  const fail = (rule, sev, detail, bad = []) => {
    const line =
      `[${rule.type}] ${rule.field ?? rule.type}: ${detail}` +
      (bad.length
        ? ` — ex.: ${JSON.stringify(bad[0]).slice(0, 220)}`
        : "");
    (sev === "warn" ? warnings : failures).push(line);
  };

  for (const rule of rules) {
    const sev = rule.severity ?? "error";
    switch (rule.type) {
      case "nonNull": {
        const v = violations((r) => val(r, rule.field) == null);
        if (v.n) fail(rule, sev, `${v.n} registo(s) sem '${rule.field}'`, v.bad);
        break;
      }
      case "unique": {
        const seen = new Set();
        const dups = new Set();
        for (const r of records) {
          const v = val(r, rule.field);
          if (v == null) continue;
          if (seen.has(v)) dups.add(v);
          seen.add(v);
        }
        if (dups.size)
          fail(
            rule,
            sev,
            `${dups.size} valor(es) duplicado(s) em '${rule.field}'`,
            [...dups].map((d) => ({ [rule.field]: d }))
          );
        break;
      }
      case "enum": {
        const v = violations((r) => {
          const x = val(r, rule.field);
          return x != null && !rule.values.includes(x);
        });
        if (v.n)
          fail(
            rule,
            sev,
            `${v.n} registo(s) com '${rule.field}' fora do enum permitido`,
            v.bad
          );
        break;
      }
      case "min": {
        const v = violations((r) => {
          const x = val(r, rule.field);
          return x != null && !(Number(x) >= rule.value);
        });
        if (v.n) fail(rule, sev, `${v.n} registo(s) com '${rule.field}' < ${rule.value}`, v.bad);
        break;
      }
      case "max": {
        const v = violations((r) => {
          const x = val(r, rule.field);
          return x != null && !(Number(x) <= rule.value);
        });
        if (v.n) fail(rule, sev, `${v.n} registo(s) com '${rule.field}' > ${rule.value}`, v.bad);
        break;
      }
      case "regex": {
        const re = new RegExp(rule.pattern);
        const v = violations((r) => {
          const x = val(r, rule.field);
          return x != null && !re.test(String(x));
        });
        if (v.n)
          fail(rule, sev, `${v.n} registo(s) com '${rule.field}' fora do padrão ${rule.pattern}`, v.bad);
        break;
      }
      case "freshness": {
        const limit = Date.now() - rule.maxAgeDays * 86400000;
        const v = violations((r) => {
          const x = val(r, rule.field);
          if (!x) return false;
          const t = Date.parse(x);
          return !Number.isNaN(t) && t >= limit;
        });
        if (v.n === 0)
          fail(rule, sev, `nenhum registo com '${rule.field}' nos últimos ${rule.maxAgeDays} dias — dados desatualizados?`);
        break;
      }
      case "minCount":
        if (records.length < rule.value)
          fail(rule, sev, `${records.length} registo(s) < mínimo exigido ${rule.value}`);
        break;
      case "maxCount":
        if (records.length > rule.value)
          fail(rule, sev, `${records.length} registo(s) > máximo exigido ${rule.value}`);
        break;
      default:
        fail(rule, sev, `tipo de regra desconhecido: ${rule.type}`);
    }
  }

  console.log(`\n=== Data Quality: ${records.length} registo(s) de ${API_URL}`);
  for (const w of warnings) console.log(`⚠️  (warn) ${w}`);
  for (const f of failures) console.log(`❌ ${f}`);
  const ok = failures.length === 0;
  console.log(
    `\n${ok ? "✅" : "❌"} ${rules.length - failures.length - warnings.length}/${rules.length} regras OK, ` +
      `${warnings.length} aviso(s), ${failures.length} falha(s)`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
