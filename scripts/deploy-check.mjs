const checks = [
  {
    name: "web",
    url: process.env.DEPLOY_CHECK_WEB_URL ?? "http://localhost:3000"
  },
  {
    name: "health",
    url: process.env.DEPLOY_CHECK_HEALTH_URL ?? "http://localhost:3001/health"
  },
  {
    name: "readiness",
    url: process.env.DEPLOY_CHECK_READINESS_URL ?? "http://localhost:3001/health/readiness"
  }
];

let hasFailure = false;

for (const check of checks) {
  try {
    const response = await fetch(check.url);
    const body = await response.text();
    console.log(`[${check.name}] ${response.status} ${check.url}`);
    console.log(body.slice(0, 200));

    if (!response.ok) {
      hasFailure = true;
    }
  } catch (error) {
    hasFailure = true;
    console.log(`[${check.name}] failed ${check.url}`);
    console.log(String(error));
  }
}

if (hasFailure) {
  process.exit(1);
}
