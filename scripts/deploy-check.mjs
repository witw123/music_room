const webUrl = process.env.DEPLOY_CHECK_WEB_URL ?? "http://localhost:3000";
const appUrl = process.env.DEPLOY_CHECK_APP_URL ?? `${webUrl.replace(/\/$/, "")}/app?client=desktop`;
const serverUrl = process.env.DEPLOY_CHECK_SERVER_URL ?? "http://localhost:3001";
const socketPath = process.env.DEPLOY_CHECK_SOCKET_PATH ?? "/ws/socket.io";

const checks = [
  {
    name: "web",
    url: webUrl
  },
  {
    name: "app",
    url: appUrl
  },
  {
    name: "health",
    url: process.env.DEPLOY_CHECK_HEALTH_URL ?? `${serverUrl}/health`
  },
  {
    name: "readiness",
    url: process.env.DEPLOY_CHECK_READINESS_URL ?? `${serverUrl}/health/readiness`
  },
  {
    name: "metrics",
    url: process.env.DEPLOY_CHECK_METRICS_URL ?? `${serverUrl}/metrics`
  }
];

function extractNextStaticAssetUrls(html, baseUrl) {
  const matches = html.match(/\/_next\/static\/[^"'()\s>]+/g) ?? [];
  return [...new Set(matches)].map((path) => new URL(path, baseUrl).toString());
}

async function checkNextStaticAssets(pageName, pageUrl, html) {
  const assetUrls = extractNextStaticAssetUrls(html, pageUrl);

  if (assetUrls.length === 0) {
    console.log(`[${pageName}] warning: no Next static assets discovered in HTML`);
    return false;
  }

  let hasFailure = false;
  for (const assetUrl of assetUrls.slice(0, 12)) {
    try {
      const response = await fetch(assetUrl, { cache: "no-store" });
      console.log(`[asset] ${response.status} ${assetUrl}`);
      if (!response.ok) {
        hasFailure = true;
      }
    } catch (error) {
      hasFailure = true;
      console.log(`[asset] failed ${assetUrl}`);
      console.log(String(error));
    }
  }

  return hasFailure;
}

let hasFailure = false;

for (const check of checks) {
  try {
    const response = await fetch(check.url);
    const body = await response.text();
    console.log(`[${check.name}] ${response.status} ${check.url}`);
    console.log(body.slice(0, 200));

    if (!response.ok) {
      hasFailure = true;
      continue;
    }

    if (check.name === "web" || check.name === "app") {
      const assetFailure = await checkNextStaticAssets(check.name, check.url, body);
      if (assetFailure) {
        hasFailure = true;
      }
    }
  } catch (error) {
    hasFailure = true;
    console.log(`[${check.name}] failed ${check.url}`);
    console.log(String(error));
  }
}

try {
  const socketHandshakeUrl = new URL(socketPath, serverUrl);
  socketHandshakeUrl.searchParams.set("EIO", "4");
  socketHandshakeUrl.searchParams.set("transport", "polling");
  const response = await fetch(socketHandshakeUrl, { cache: "no-store" });
  const body = await response.text();
  console.log(`[socket] ${response.status} ${socketHandshakeUrl.toString()}`);
  console.log(body.slice(0, 200));
  if (!response.ok || !body.startsWith("0")) {
    hasFailure = true;
  }
} catch (error) {
  hasFailure = true;
  console.log(`[socket] failed ${serverUrl}${socketPath}`);
  console.log(String(error));
}

if (hasFailure) {
  process.exit(1);
}
