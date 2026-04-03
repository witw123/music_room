function getDefaultApiBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost:3001";
}

export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || getDefaultApiBaseUrl();
