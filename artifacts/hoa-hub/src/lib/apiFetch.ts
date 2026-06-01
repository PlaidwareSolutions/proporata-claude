import { customFetch } from "@workspace/api-client-react";

export async function apiFetch<T = unknown>(opts: {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  data?: unknown;
}): Promise<T> {
  const init: RequestInit = { method: opts.method };
  if (opts.data !== undefined && opts.method !== "GET") {
    init.body = JSON.stringify(opts.data);
    init.headers = { "content-type": "application/json" };
  }
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return customFetch<T>(`${base}/api${opts.url}`, init);
}
