import { fetch } from "expo/fetch";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LINK_LOCAL_PREFIX = "169.254.";

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function isLocalNetworkHost(hostname: string): boolean {
  return (
    isLoopback(hostname) ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.20.") ||
    hostname.startsWith("172.21.") ||
    hostname.startsWith("172.22.") ||
    hostname.startsWith("172.23.") ||
    hostname.startsWith("172.24.") ||
    hostname.startsWith("172.25.") ||
    hostname.startsWith("172.26.") ||
    hostname.startsWith("172.27.") ||
    hostname.startsWith("172.28.") ||
    hostname.startsWith("172.29.") ||
    hostname.startsWith("172.30.") ||
    hostname.startsWith("172.31.") ||
    hostname.startsWith(LINK_LOCAL_PREFIX)
  );
}

function isLikelyLanHost(hostname: string): boolean {
  return (
    isLocalNetworkHost(hostname) ||
    hostname.toLowerCase().endsWith(".local") ||
    hostname.toLowerCase().endsWith(".lan") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname.includes(":") // IPv6 literals
  );
}

function normalizeUrlCandidate(candidate?: string | null): URL | null {
  if (!candidate) return null;
  try {
    const trimmed = candidate.trim();
    const sanitized = trimmed.startsWith("exp://")
      ? trimmed.replace(/^exp:\/\//, "http://")
      : trimmed;
    const withProtocol = /:\/\//.test(sanitized) ? sanitized : `http://${sanitized}`;
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

function getExpoDevHostname(): string | null {
  const candidates = [
    Constants?.expoConfig?.hostUri,
    (Constants?.expoConfig as any)?.debuggerHost,
    (Constants as any)?.manifest?.hostUri,
    (Constants as any)?.manifest?.debuggerHost,
    (Constants as any)?.expoGoConfig?.hostUri,
    (Constants as any)?.expoGoConfig?.debuggerHost,
    (Constants as any)?.expoGoConfig?.developer?.host,
    (Constants as any)?.expoGoConfig?.developer?.hostname,
    (Constants as any)?.expoGoConfig?.packagerOpts?.hostUri,
    (Constants as any)?.manifest2?.extra?.expoGo?.developer?.host,
    (Constants as any)?.manifest2?.extra?.expoGo?.packagerOpts?.hostUri,
  ];

  for (const candidate of candidates) {
    const url = normalizeUrlCandidate(candidate);
    if (url && url.hostname && isLikelyLanHost(url.hostname)) {
      return url.hostname;
    }
  }

  const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL as string | undefined;
  if (scriptURL) {
    const parsed = normalizeUrlCandidate(scriptURL);
    if (parsed && parsed.hostname && isLikelyLanHost(parsed.hostname)) {
      return parsed.hostname;
    }
  }

  return null;
}

function parseConfiguredHost(rawHost: string): {
  hostname: string;
  port: string | null;
  protocolHint: string | null;
  hadExplicitProtocol: boolean;
} {
  const trimmed = rawHost.trim();
  const hadExplicitProtocol = /:\/\//.test(trimmed);
  const parsed = normalizeUrlCandidate(trimmed);

  if (!parsed) {
    throw new Error(`Invalid EXPO_PUBLIC_DOMAIN value: ${rawHost}`);
  }

  return {
    hostname: parsed.hostname,
    port: parsed.port || null,
    protocolHint: hadExplicitProtocol ? parsed.protocol.replace(":", "") : null,
    hadExplicitProtocol,
  };
}

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  const configuredHost = process.env.EXPO_PUBLIC_DOMAIN;
  if (!configuredHost) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

  const { hostname: initialHost, port, protocolHint, hadExplicitProtocol } =
    parseConfiguredHost(configuredHost);

  let hostname = initialHost;
  let protocol = protocolHint ?? (isLocalNetworkHost(hostname) ? "http" : "https");

  const shouldResolveLanHost = Platform.OS !== "web" && isLoopback(hostname);
  if (shouldResolveLanHost) {
    const lanHost = getExpoDevHostname();
    if (lanHost) {
      hostname = lanHost;
    } else if (Platform.OS === "android") {
      // Android emulators expose the host machine at 10.0.2.2
      hostname = "10.0.2.2";
    } else {
      console.warn(
        "[Kidspot] Could not determine LAN host for API calls. " +
          "Set EXPO_PUBLIC_DOMAIN to your machine's IP (e.g. 192.168.0.15:5000) " +
          "or run `expo start --lan` so the Expo dev server shares its local address.",
      );
    }

    if (!hadExplicitProtocol) {
      protocol = isLocalNetworkHost(hostname) ? "http" : "https";
    }
  }

  const portSegment = port ? `:${port}` : "";
  const base = `${protocol}://${hostname}${portSegment}`;
  const url = new URL(base);

  return url.href;
}

let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}

export function getAuthToken(): string | null {
  return _authToken;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const headers: Record<string, string> = {};
    if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;

    const res = await fetch(url.toString(), {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
