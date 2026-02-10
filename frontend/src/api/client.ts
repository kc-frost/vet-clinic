//const API_BASE = "/api";

// used to connect to the backend's api route
// can commit to branch BUT DELETE BEFORE PUSHING TO MAIN. do not deploy this code as is
const API_BASE = "http://localhost:3001/api";

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const errorText = contentType.includes("application/json")
      ? JSON.stringify(await res.json().catch(() => ({})))
      : await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${path} failed (${res.status}) ${errorText}`);
  }

  if (res.status === 204) return undefined as T;

  if (!contentType.includes("application/json")) {
    // If backend accidentally returns HTML, this prevents JSON parse crashes
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON from ${path} but got: ${text.slice(0, 80)}...`);
  }

  return res.json();
}
