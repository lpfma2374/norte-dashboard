// Smoke/load k6 contra a API read-only — só GETs públicos.
// Rampa suave de 5 VUs; thresholds falham o pipeline se a API degradar.
// Cloudflare bloqueia UAs de biblioteca: usar UA tipo browser.
// K6_TARGET_URL vem de uma repo variable (ex.: https://api.exemplo.workers.dev/api/records).
import http from 'k6/http';
import { check, sleep } from 'k6';

const URL_ = __ENV.K6_TARGET_URL;
if (!URL_) { throw new Error('K6_TARGET_URL em falta'); }

export const options = {
  scenarios: {
    rampa: { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: '10s', target: 5 },
      { duration: '30s', target: 5 },
      { duration: '10s', target: 0 },
    ] },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1200'] },
};

export default function () {
  const r = http.get(URL_, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 k6-smoke/1.0' },
  });
  check(r, { 'GET API → 200': (r) => r.status === 200 });
  sleep(1);
}
