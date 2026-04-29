export const config = {
  runtime: "edge",
};

// Main upstream destination (trailing slash removed if present)
const DESTINATION = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// Headers that should never be forwarded upstream
const BLOCKED_HEADERS = [
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
];

// Quick check for ignored headers
function shouldSkipHeader(name) {
  return BLOCKED_HEADERS.includes(name) || name.startsWith("x-vercel-");
}

// Rebuild incoming request URL using the target base domain
function buildTargetUrl(originalUrl) {
  const slashIndex = originalUrl.indexOf("/", 8);

  // No path found, fallback to root
  if (slashIndex === -1) {
    return DESTINATION + "/";
  }

  return DESTINATION + originalUrl.substring(slashIndex);
}

// Clone headers while keeping only safe / useful values
function copyHeaders(sourceHeaders) {
  const headers = new Headers();
  let ipAddress = null;

  for (const [key, value] of sourceHeaders.entries()) {
    const lowerKey = key.toLowerCase();

    if (shouldSkipHeader(lowerKey)) {
      continue;
    }

    // Prefer real client IP if provided
    if (lowerKey === "x-real-ip") {
      ipAddress = value;
      continue;
    }

    // Fallback if x-real-ip is missing
    if (lowerKey === "x-forwarded-for") {
      if (!ipAddress) {
        ipAddress = value;
      }
      continue;
    }

    headers.set(key, value);
  }

  // Re-attach a single client IP value
  if (ipAddress) {
    headers.set("x-forwarded-for", ipAddress);
  }

  return headers;
}

export default async function handler(request) {
  // Fail early if environment variable was not configured
  if (!DESTINATION) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
    });
  }

  try {
    const finalUrl = buildTargetUrl(request.url);
    const method = request.method;
    const headers = copyHeaders(request.headers);

    const options = {
      method,
      headers,
      redirect: "manual", // pass redirects back to client untouched
      duplex: "half", // needed for streamed request bodies
    };

    // Only attach body when request type supports it
    if (method !== "GET" && method !== "HEAD") {
      options.body = request.body;
    }

    return await fetch(finalUrl, options);
  } catch (error) {
    console.error("relay error:", error);

    return new Response("Bad Gateway: Tunnel Failed", {
      status: 502,
    });
  }
}
