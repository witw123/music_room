import {
  buildCookie,
  csrfCookieName,
  getSessionTokenFromCookie,
  hasValidCsrfPair,
  sessionCookieName
} from "./session-cookie";

describe("session cookie security", () => {
  it("parses the session cookie without accepting unrelated values", () => {
    expect(getSessionTokenFromCookie(`${sessionCookieName}=secret; other=value`)).toBe("secret");
    expect(getSessionTokenFromCookie("other=value")).toBeUndefined();
  });

  it("requires matching cookie and header CSRF tokens", () => {
    expect(hasValidCsrfPair(`${csrfCookieName}=csrf-value`, "csrf-value")).toBe(true);
    expect(hasValidCsrfPair(`${csrfCookieName}=csrf-value`, "other")).toBe(false);
    expect(hasValidCsrfPair(undefined, "csrf-value")).toBe(false);
  });

  it("builds host-only secure http-only cookies", () => {
    expect(buildCookie(sessionCookieName, "secret", { maxAgeSeconds: 60 })).toContain("Secure");
    expect(buildCookie(sessionCookieName, "secret", { maxAgeSeconds: 60 })).toContain("HttpOnly");
    expect(buildCookie(sessionCookieName, "secret", { maxAgeSeconds: 60 })).toContain("Path=/");
  });
});
