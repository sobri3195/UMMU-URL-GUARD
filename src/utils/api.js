export async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `API returned ${response.status}; check Python service or deployment limits.`,
      );
    }
    if (!response.ok)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail ?? data),
      );
    return data;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error(
        "Request timed out. For training, use python -m ml.train_local with the same CSV.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export function post(path, data) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
export function upload(path, file) {
  const body = new FormData();
  body.append("file", file);
  return request(path, { method: "POST", body });
}
