export interface EditAuthEnv {
  EDIT_MODE_PASSWORD?: string;
}

const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

const jsonResponse = (
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, ...extraHeaders },
  });

const digest = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

const securelyMatches = async (candidate: string, expected: string) => {
  const [candidateDigest, expectedDigest] = await Promise.all([
    digest(candidate),
    digest(expected),
  ]);
  let mismatch = 0;
  for (let index = 0; index < candidateDigest.length; index += 1) {
    mismatch |= candidateDigest[index] ^ expectedDigest[index];
  }
  return mismatch === 0;
};

export async function isEditPasswordValid(
  candidate: string,
  configuredPassword: string | undefined,
) {
  if (!configuredPassword) return false;
  return securelyMatches(candidate, configuredPassword);
}

export async function handleEditAuthRequest(
  request: Request,
  env: EditAuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/edit-auth") return null;

  if (request.method !== "POST") {
    return jsonResponse(
      { authenticated: false, error: "Method not allowed." },
      405,
      { allow: "POST" },
    );
  }

  const configuredPassword = env.EDIT_MODE_PASSWORD;
  if (!configuredPassword) {
    return jsonResponse(
      {
        authenticated: false,
        error: "Edit Mode authentication is unavailable.",
      },
      503,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { authenticated: false, error: "Invalid request." },
      400,
    );
  }

  const password =
    payload && typeof payload === "object" && "password" in payload
      ? (payload as { password?: unknown }).password
      : undefined;
  if (typeof password !== "string") {
    return jsonResponse(
      { authenticated: false, error: "Invalid request." },
      400,
    );
  }

  if (!(await isEditPasswordValid(password, configuredPassword))) {
    return jsonResponse(
      { authenticated: false, error: "Incorrect password." },
      401,
    );
  }

  return jsonResponse({ authenticated: true }, 200);
}
